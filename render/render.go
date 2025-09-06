package render

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	pngenc "image/png"
	"io"
	"math"
	"os"
	"strconv"

	"github.com/airbusgeo/godal"
	"github.com/llgcode/draw2d"
	"github.com/llgcode/draw2d/draw2dimg"
	"github.com/sirupsen/logrus"
)

func RenderAndReproject(rs *RadialSet, lut func(float64) color.Color, width, height int) io.ReadCloser {
	godal.RegisterAll()

	// 1) Render the radial set to an RGBA image in Azimuthal Equidistant
	intermediateSize := 1000 // initial render size before reprojection
	renderImg := render(rs, intermediateSize, lut)

	// 2) Create a MEM dataset with 4 bands (RGBA) and write pixels band-by-band
	srcDS, err := godal.Create(godal.DriverName("MEM"), "", 4, godal.Byte, renderImg.Rect.Dx(), renderImg.Rect.Dy())
	if err != nil {
		// fallback: try vsimem GTiff if MEM driver unavailable
		srcDS, err = godal.Create(godal.GTiff, "/vsimem/src.tif", 4, godal.Byte, renderImg.Rect.Dx(), renderImg.Rect.Dy())
		if err != nil {
			// last resort: return Go-encoded PNG of the unwarped render
			f, _ := os.CreateTemp("", "*.png")
			_ = pngenc.Encode(f, renderImg)
			return f
		}
	}
	defer srcDS.Close()

	// Set source dataset projection (Azimuthal Equidistant centered on radar) and geotransform
	srWKT := azimuthalEquidistantWKT(rs.Lat, rs.Lon)
	sr, _ := godal.NewSpatialRefFromWKT(srWKT)
	defer sr.Close()
	_ = srcDS.SetSpatialRef(sr)

	distM := float64(rs.Radius)
	pixStepM := distM * 2.0 / float64(renderImg.Rect.Dx())
	_ = srcDS.SetGeoTransform([6]float64{-distM, pixStepM, 0, distM, 0, -pixStepM})

	// Deinterleave RGBA into per-band planes and write bands
	w := renderImg.Rect.Dx()
	h := renderImg.Rect.Dy()
	rplane := make([]byte, w*h)
	gplane := make([]byte, w*h)
	bplane := make([]byte, w*h)
	aplane := make([]byte, w*h)
	idx := 0
	for y := 0; y < h; y++ {
		row := renderImg.Pix[y*renderImg.Stride : y*renderImg.Stride+w*4]
		for x := 0; x < w; x++ {
			rplane[idx] = row[x*4+0]
			gplane[idx] = row[x*4+1]
			bplane[idx] = row[x*4+2]
			aplane[idx] = row[x*4+3]
			idx++
		}
	}
	bands := srcDS.Bands()
	// Set band color interpretations so -srcalpha is recognized
	_ = bands[0].SetColorInterp(godal.CIRed)
	_ = bands[1].SetColorInterp(godal.CIGreen)
	_ = bands[2].SetColorInterp(godal.CIBlue)
	_ = bands[3].SetColorInterp(godal.CIAlpha)
	if err := bands[0].Write(0, 0, rplane, w, h); err != nil {
		logrus.Errorf("band0 write: %v", err)
	}
	if err := bands[1].Write(0, 0, gplane, w, h); err != nil {
		logrus.Errorf("band1 write: %v", err)
	}
	if err := bands[2].Write(0, 0, bplane, w, h); err != nil {
		logrus.Errorf("band2 write: %v", err)
	}
	if err := bands[3].Write(0, 0, aplane, w, h); err != nil {
		logrus.Errorf("band3 write: %v", err)
	}

	// 3) Warp to EPSG:3857 with the CONUS extent and desired output size
	// Bounds from previous implementation (Web Mercator meters)
	upperLeftX := -13914936.3491592
	upperLeftY := 6446275.84101716
	lowerRightX := -7235766.90156278
	lowerRightY := 2875744.62435224

	warpSwitches := []string{
		"-of", "MEM", // in-memory output dataset
		"-t_srs", "EPSG:3857",
		"-te_srs", "EPSG:3857",
		"-srcalpha",
		"-dstalpha",
		"-ts", strconv.Itoa(width), strconv.Itoa(height),
		"-te",
		fmt.Sprintf("%f", upperLeftX),
		fmt.Sprintf("%f", lowerRightY),
		fmt.Sprintf("%f", lowerRightX),
		fmt.Sprintf("%f", upperLeftY),
	}
	// Create an in-memory warped dataset (no filename) in EPSG:3857
	warpedDS, err := godal.Warp("", []*godal.Dataset{srcDS}, warpSwitches)
	if err != nil {
		logrus.Errorf("godal.Warp failed: %v", err)
		f, _ := os.CreateTemp("", "*.png")
		_ = pngenc.Encode(f, renderImg)
		return f
	}
	defer warpedDS.Close()

	// 4) Translate to PNG into a temp file name, then open and return the reader
	tmpf, _ := os.CreateTemp("", "*.png")
	tmpname := tmpf.Name()
	tmpf.Close()
	outDS, err := warpedDS.Translate(tmpname, []string{"-of", "PNG"})
	if err != nil {
		logrus.Errorf("godal.Translate failed: %v", err)
		// Fallback: read back bands and encode with Go's PNG
		w := width
		h := height
		planes := make([][]byte, 4)
		planes[0] = make([]byte, w*h)
		planes[1] = make([]byte, w*h)
		planes[2] = make([]byte, w*h)
		planes[3] = make([]byte, w*h)
		bnds := warpedDS.Bands()
		if len(bnds) >= 4 {
			_ = bnds[0].Read(0, 0, planes[0], w, h)
			_ = bnds[1].Read(0, 0, planes[1], w, h)
			_ = bnds[2].Read(0, 0, planes[2], w, h)
			_ = bnds[3].Read(0, 0, planes[3], w, h)
			img := image.NewRGBA(image.Rect(0, 0, w, h))
			for y := 0; y < h; y++ {
				for x := 0; x < w; x++ {
					i := y*w + x
					off := y*img.Stride + x*4
					img.Pix[off+0] = planes[0][i]
					img.Pix[off+1] = planes[1][i]
					img.Pix[off+2] = planes[2][i]
					img.Pix[off+3] = planes[3][i]
				}
			}
			f, _ := os.CreateTemp("", "*.png")
			_ = pngenc.Encode(f, img)
			return f
		}
		// If we can't read bands, still return a valid (empty) PNG
		f, _ := os.CreateTemp("", "*.png")
		_ = pngenc.Encode(f, image.NewRGBA(image.Rect(0, 0, w, h)))
		return f
	}
	outDS.Close()
	f, _ := os.Open(tmpname)
	return f
}

// little helper to keep both a GDAL dataset and the DS's backing Image together
// both for convenience but also to make sure the DS's backing memory doesn't get GCd
// Build WKT for an Azimuthal Equidistant projection centered on given lat/lon
func azimuthalEquidistantWKT(lat, lon float64) string {
	return fmt.Sprintf(
		`PROJCS[
            "unnamed",
            GEOGCS[
                "WGS 84",
                DATUM[
                    "unknown",
                    SPHEROID["WGS84",6378137,298.257223563]
                ],
                PRIMEM["Greenwich",0],
                UNIT["degree",0.0174532925199433]
            ],
            PROJECTION["Azimuthal_Equidistant"],
            PARAMETER["latitude_of_center",%f],
            PARAMETER["longitude_of_center",%f],
            PARAMETER["false_easting",0],
            PARAMETER["false_northing",0],
            UNIT["metre",1,AUTHORITY["EPSG","9001"]]
        ]`,
		lat,
		lon,
	)
}

func render(rs *RadialSet, imageSize int, lut func(float64) color.Color) *image.RGBA {
	width := float64(imageSize)
	height := float64(imageSize)

	canvas := image.NewRGBA(image.Rect(0, 0, imageSize, imageSize))
	draw.Draw(canvas, canvas.Bounds(), image.Transparent, image.ZP, draw.Src)

	gc := draw2dimg.NewGraphicContext(canvas)

	xc := width / 2
	yc := height / 2
	pxPerKm := width / 2 / (float64(rs.Radius) / 1000)

	for _, radial := range rs.Radials {
		// round to the nearest rounded azimuth for the given resolution.
		// ex: for radial 20.5432, round to 20.5
		azimuthAngle := float64(radial.AzimuthAngle) - 90
		if azimuthAngle < 0 {
			azimuthAngle = 360.0 + azimuthAngle
		}
		azimuthSpacing := radial.AzimuthResolution
		azimuth := math.Floor(azimuthAngle)
		if math.Floor(azimuthAngle+float64(azimuthSpacing)) > azimuth {
			azimuth += float64(azimuthSpacing)
		}
		startAngle := float64(azimuth * (math.Pi / 180.0))        /* angles are specified */
		angleDelta := float64(azimuthSpacing * (math.Pi / 180.0)) /* clockwise in radians */

		// start drawing gates from the start of the first gate
		firstGatePx := (radial.StartRange / 1000) * pxPerKm
		gateIntervalKm := radial.GateInterval / 1000
		gateWidthPx := gateIntervalKm * pxPerKm
		distanceX, distanceY := firstGatePx, firstGatePx
		gc.SetLineWidth(gateWidthPx + 1)
		gc.SetLineCap(draw2d.ButtCap)

		numGates := len(radial.Gates)
		for i, v := range radial.Gates {
			if v != GateEmptyValue {
				gc.MoveTo(xc+math.Cos(startAngle)*distanceX, yc+math.Sin(startAngle)*distanceY)

				// make the gates connect visually by extending arcs so there is no space between adjacent gates.
				if i == 0 {
					gc.ArcTo(xc, yc, distanceX, distanceY, startAngle-.001, angleDelta+.001)
				} else if i == numGates-1 {
					gc.ArcTo(xc, yc, distanceX, distanceY, startAngle, angleDelta)
				} else {
					gc.ArcTo(xc, yc, distanceX, distanceY, startAngle, angleDelta+.001)
				}

				gc.SetStrokeColor(lut(v))
				gc.Stroke()
			}

			distanceX += gateWidthPx
			distanceY += gateWidthPx
			azimuth += radial.AzimuthResolution
		}
	}

	return canvas
}
