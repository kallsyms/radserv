package render

import (
	"fmt"

	"github.com/kallsyms/go-nexrad/archive2"
	"github.com/kallsyms/radserv/level3"
)

const GateEmptyValue = float64(-9999)

type Radial struct {
	// The angle this radial starts at. East (or along the X axis) is 0, going clockwise.
	AzimuthAngle float64
	// How "wide" this radial is in degrees
	AzimuthResolution float64
	// The distance in meters from the origin to the first gate
	StartRange float64
	// How "thick" each gate is from the origin in meters
	GateInterval float64
	Gates        []float64
}

type RadialSlice []*Radial

func (rs RadialSlice) Len() int           { return len(rs) }
func (rs RadialSlice) Less(i, j int) bool { return rs[i].AzimuthAngle < rs[j].AzimuthAngle }
func (rs RadialSlice) Swap(i, j int)      { rs[i], rs[j] = rs[j], rs[i] }

type RadialSet struct {
	// latitude of origin
	Lat float64
	// longitude of origin
	Lon float64
	// The distance from the origin to the edge of the radial image in meters
	Radius         int
	ElevationAngle float64
	Radials        RadialSlice
}

func RadialSetFromLevel2(m31s []*archive2.Message31, product string) (*RadialSet, error) {
	s := &RadialSet{
		Lat:            float64(m31s[0].VolumeData.Lat),
		Lon:            float64(m31s[0].VolumeData.Long),
		Radius:         460 * 1000,
		ElevationAngle: float64(m31s[0].Header.ElevationAngle),
	}

	for _, m31 := range m31s {
		r := &Radial{
			AzimuthAngle:      float64(m31.Header.AzimuthAngle),
			AzimuthResolution: m31.Header.AzimuthResolutionSpacing(),
		}

		var moment *archive2.DataMoment
		switch product {
		case "ref":
			moment = m31.ReflectivityData
		case "vel":
			moment = m31.VelocityData
		default:
			return nil, fmt.Errorf("Invalid product %q", product)
		}

		r.StartRange = float64(moment.DataMomentRange)
		r.GateInterval = float64(moment.DataMomentRangeSampleInterval)
		r.Gates = make([]float64, len(moment.Data))
		for i, d := range moment.ScaledData() {
			if d != archive2.MomentDataBelowThreshold && d != archive2.MomentDataFolded {
				r.Gates[i] = float64(d)
			} else {
				r.Gates[i] = GateEmptyValue
			}
		}

		s.Radials = append(s.Radials, r)
	}

	return s, nil
}

func RadialSetFromLevel3(l3 *level3.Level3File) (*RadialSet, error) {
	s := &RadialSet{
		// XXX: ICenter, JCenter?
		Lat:    float64(l3.ProductDescriptionMessage.Lat) / 1000,
		Lon:    float64(l3.ProductDescriptionMessage.Long) / 1000,
		Radius: 460 * 1000,
		// TODO: ElevationAngle
	}

	for _, l3radial := range l3.Radials {
		gates := make([]float64, len(l3radial.Data))
		for i, g := range l3radial.Data {
			if g != 0 {
				gates[i] = float64(g)
			} else {
				gates[i] = GateEmptyValue
			}
		}

		r := &Radial{
			AzimuthAngle:      float64(l3radial.Header.AngleStart) / 10,
			AzimuthResolution: float64(l3radial.Header.AngleDelta) / 10,
			StartRange:        float64(l3.RadialPacketHeader.FirstRangeBinIndex),
			GateInterval:      1000, // XXX RadialPacketHeader.ScaleFactor?
			Gates:             gates,
		}

		s.Radials = append(s.Radials, r)
	}

	return s, nil
}
