package render

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"io"
	"math"
	"os"

	"github.com/llgcode/draw2d"
	"github.com/lukeroth/gdal"

	"github.com/llgcode/draw2d/draw2dimg"
)

func RenderAndReproject(rs *RadialSet, lut func(float64) color.Color, width, height int) io.ReadCloser {
	intermediateSize := 1000 // width and height of initial rendered image before projection
	renderDS := getRenderDS(rs, intermediateSize, lut)
	defer renderDS.DS.Close()

	// TODO: we don't need warpedImg anymore since we use GDAL translate to convert to PNG
	// is there some other format/backend that would be faster for GDAL just to hold between warp and translate?
	warpedImg := image.NewRGBA(image.Rect(0, 0, width, height))
	warpedDS := makeImageDS(warpedImg)
	defer warpedDS.DS.Close()

	spatialRef := gdal.CreateSpatialReference("")
	spatialRef.FromEPSG(3857)
	srString, _ := spatialRef.ToWKT()
	warpedDS.DS.SetProjection(srString)

	// gdaltransform -s_srs epsg:4326 -t_srs epsg:3857
	// -125 50
	// -13914936.3491592 6446275.84101716 0
	upperLeftX := -13914936.3491592
	upperLeftY := 6446275.84101716
	// -65 25
	// -7235766.90156278 2875744.62435224 0
	lowerRightX := -7235766.90156278
	lowerRightY := 2875744.62435224
	warpedDS.DS.SetGeoTransform([6]float64{
		upperLeftX,
		(lowerRightX - upperLeftX) / float64(warpedDS.Image.Rect.Dx()),
		0,
		upperLeftY,
		0,
		(lowerRightY - upperLeftY) / float64(warpedDS.Image.Rect.Dy()),
	})

	gdal.Warp("", &warpedDS.DS, []gdal.Dataset{renderDS.DS}, []string{
		"-srcalpha",
		"-dstalpha",
	})

	// Use gdal.Translate instead of go's png.Encode. Seems to be ~1.6x faster (600ms instead of 1000ms)
	png, _ := os.CreateTemp("", "*.png")
	gdal.Translate(png.Name(), warpedDS.DS, []string{})

	return png
}

// little helper to keep both a GDAL dataset and the DS's backing Image together
// both for convenience but also to make sure the DS's backing memory doesn't get GCd
type imageDS struct {
	DS    gdal.Dataset
	Image *image.RGBA
}

func getRenderDS(rs *RadialSet, imageSize int, lut func(float64) color.Color) imageDS {
	renderImg := render(rs, imageSize, lut)
	renderDS := makeImageDS(renderImg)

	// from pyart's projection: https://github.com/ARM-DOE/pyart/blob/master/pyart/io/output_to_geotiff.py#L119
	renderDS.DS.SetProjection(fmt.Sprintf(
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
		rs.Lat,
		rs.Lon,
	))

	distM := float64(rs.Radius)
	pixStepM := distM * 2.0 / float64(renderImg.Rect.Dx())
	renderDS.DS.SetGeoTransform([6]float64{-distM, pixStepM, 0, distM, 0, -pixStepM})

	// sanity check renderDS was loaded properly
	// gdal.Translate("/tmp/o.png", renderDS.DS, []string{})

	return renderDS
}

func makeImageDS(warpedImg *image.RGBA) imageDS {
	warpedDSName := fmt.Sprintf(
		"MEM:::DATAPOINTER=%p,PIXELS=%d,LINES=%d,BANDS=4,DATATYPE=Byte,PIXELOFFSET=4,BANDOFFSET=1",
		&warpedImg.Pix[0],
		warpedImg.Rect.Dx(),
		warpedImg.Rect.Dy(),
	)

	warpedDS, _ := gdal.Open(warpedDSName, gdal.Update)

	return imageDS{
		warpedDS,
		warpedImg,
	}
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
