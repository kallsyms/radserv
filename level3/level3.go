package level3

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"os"

	"github.com/dsnet/compress/bzip2"
	"github.com/sirupsen/logrus"
)

type TextHeader struct {
	FileType         [6]byte // SDUS__
	_                byte    // space
	RadarIdentifier  [4]byte
	_                byte // space
	DDHHMM           [6]byte
	_                [3]byte // \r\r\n
	Product          [3]byte
	RadarIdentifier3 [3]byte
	_                [3]byte // \r\r\n
}

// https://www.roc.noaa.gov/wsr88d/PublicDocs/ICDs/2620001Y.pdf
// pg 14
type MessageHeader struct {
	Code       int16
	Date       int16
	Time       int32
	Length     int32
	SourceID   int16
	DestID     int16
	BlockCount int16
}

// pg 39
type ProductDescriptionMessage struct {
	Divider               int16
	Lat                   int32
	Long                  int32
	Height                int16
	Code                  int16
	OperationalMode       int16
	VolumeCoveragePattern int16
	SequenceNumber        int16
	VolumeScanNumber      int16
	VolumeScanDate        int16
	VolumeScanTime        int32
	GenerationDate        int16
	GenerationTime        int32

	ProductDependent1_27 int16
	ProductDependent2_28 int16

	ElevationNumber int16

	ProductDependent3_30 int16

	ProductDependent31_46 [32]byte
	ProductDependent4_47  int16
	ProductDependent5_48  int16
	ProductDependent6_49  int16
	ProductDependent7_50  int16
	ProductDependent8_51  int16
	ProductDependent9_52  int16
	ProductDependent10_53 int16

	Version         int8
	SpotBlank       bool
	SymbologyOffset int32
	GraphicOffset   int32
	TabularOffset   int32
}

// pg. 49
type ProductSymbologyBlock struct {
	Divider      int16
	BlockID      int16
	Length       int32
	LayerCount   int16
	LayerDivider int16
	LayerLength  int32
}

// pg. 117
type RadialPacketHeader struct {
	Code               int16
	FirstRangeBinIndex int16
	BinCount           int16
	ICenter            int16
	JCenter            int16
	ScaleFactor        int16
	RadialCount        int16
}

// pg. 118
type RadialHeader struct {
	Length     int16
	AngleStart int16
	AngleDelta int16
}

type Radial struct {
	Header RadialHeader
	Data   []uint8
}

type Level3File struct {
	TextHeader                TextHeader
	MessageHeader             MessageHeader
	ProductDescriptionMessage ProductDescriptionMessage
	ProductSymbologyBlock     ProductSymbologyBlock
	RadialPacketHeader        RadialPacketHeader
	Radials                   []*Radial
}

// https://www.weather.gov/media/tg/noaaport_radar_products.pdf
var SUPPORTED_PRODUCTS = [...]int16{
	153, // N_B - base reflectivity 248nmi
	154, // N_G - base radial vel 162nmi
	32,  // DHR - digital hybrid reflectivity
	37,  // NCR - composite reflectivity 124nmi
	135, // EET - echo tops
	159, // N_X - differential reflectivity
	161, // N_C - correlation coefficient
	163, // N_K - differential phase
	165, // N_H - hydrometeor classification
	166, // N_M - melting layer
	176, // DPR - instant precipitation rate
	169, // OHA - one hour accumulation
	172, // DTA - storm total accumulation
}

func NewLevel3(baseReader io.Reader) (*Level3File, error) {
	data, err := ioutil.ReadAll(baseReader)
	if err != nil {
		return nil, err
	}

	headerOffset := bytes.Index(data, []byte("SDUS"))
	if headerOffset == -1 {
		return nil, errors.New("Cannot find L3 header")
	}
	data = data[headerOffset:]

	reader := bytes.NewReader(data)

	l3 := &Level3File{}
	binary.Read(reader, binary.BigEndian, &l3.TextHeader)
	binary.Read(reader, binary.BigEndian, &l3.MessageHeader)

	supported := false
	for _, supportedCode := range SUPPORTED_PRODUCTS {
		if l3.MessageHeader.Code == supportedCode {
			supported = true
			break
		}
	}
	if !supported {
		return l3, fmt.Errorf("Unsupported product code %d", l3.MessageHeader.Code)
	}

	binary.Read(reader, binary.BigEndian, &l3.ProductDescriptionMessage)

	if l3.ProductDescriptionMessage.Divider != -1 {
		return l3, fmt.Errorf("Corrupt ProductDescriptionMessage Divider %d", l3.ProductDescriptionMessage.Divider)
	}

	compressHeader := make([]byte, 2)
	curPos, _ := reader.Seek(0, os.SEEK_CUR)
	io.ReadFull(reader, compressHeader)
	reader.Seek(curPos, os.SEEK_SET)

	var symReader io.Reader
	symReader = reader
	if bytes.Equal(compressHeader, []byte("BZ")) {
		logrus.Tracef("Found bzip2 symbology block")
		symReader, _ = bzip2.NewReader(reader, nil)
	}

	binary.Read(symReader, binary.BigEndian, &l3.ProductSymbologyBlock)

	if l3.ProductSymbologyBlock.Divider != -1 {
		return l3, fmt.Errorf("Corrupt ProductSymbologyBlock Divider %d", l3.ProductSymbologyBlock.Divider)
	}

	binary.Read(symReader, binary.BigEndian, &l3.RadialPacketHeader)

	for i := int16(0); i < l3.RadialPacketHeader.RadialCount; i++ {
		radial := &Radial{}
		binary.Read(symReader, binary.BigEndian, &radial.Header)

		if l3.RadialPacketHeader.Code == 16 {
			radial.Data = make([]uint8, radial.Header.Length)
			io.ReadFull(symReader, radial.Data)
		} else if l3.RadialPacketHeader.Code == int16(-20705) {
			rleSize := radial.Header.Length * 2
			encoded := make([]uint8, rleSize)
			io.ReadFull(symReader, encoded)

			radial.Data = []uint8{}
			for _, c := range encoded {
				color := c & 0x0f
				runs := (c & 0xf0) >> 4
				for i := uint8(0); i < runs; i++ {
					radial.Data = append(radial.Data, color)
				}
			}
		} else {
			logrus.Infof("Unknown radial packet code %v", l3.RadialPacketHeader.Code)
			break
		}

		l3.Radials = append(l3.Radials, radial)
	}

	return l3, nil
}
