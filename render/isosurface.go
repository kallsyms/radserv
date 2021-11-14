package render

import (
	"fmt"
	"io"
	"math"
	"sort"

	"github.com/fogleman/mc"
)

type ElevationSet []*RadialSet

func (es ElevationSet) Len() int           { return len(es) }
func (es ElevationSet) Less(i, j int) bool { return es[i].ElevationAngle < es[j].ElevationAngle }
func (es ElevationSet) Swap(i, j int)      { es[i], es[j] = es[j], es[i] }

// http://opengmsteam.com/articles/3D%20modelling%20strategy%20for%20weather%20radar%20data%20analysis.pdf
// tl;dr
//   * subsample data to have a consistent number of (and consistent placement of) radials
//     * but we don't have to because NEXRAD is consistent
//   * construct hexahedrons between sectors (adjacent elevations)
//   * do marching cubes on the hexahedrons
// Resulting tris are Z up
func CreateIsosurface(elvs ElevationSet, threshold float64) []mc.Triangle {
	sort.Sort(elvs)

	for _, elv := range elvs {
		sort.Sort(elv.Radials)
	}

	// MarchingCubesGrid iterates with d(epth) as the outer-most loop, which corresponds to
	// elevations for us
	// w
	nGates := len(elvs[0].Radials[0].Gates)
	// h
	nRadials := len(elvs[0].Radials)
	// d
	nElvs := len(elvs)

	// the target azimuthResolution. must be >= the max azimuthResolution in any radial
	// since we currently only repeat radials with a smaller resolution
	azimuthResolution := elvs[0].Radials[0].AzimuthResolution

	data := make([]float64, nElvs*nRadials*nGates)
	idx := 0

	for _, elv := range elvs {
		for _, rad := range elv.Radials {
			// ex: azimuthResolution = 0.5, this radial is 1 so repeat = 2
			repeat := int(rad.AzimuthResolution / azimuthResolution)
			for i := 0; i < repeat; i++ {
				// TODO: truncate rad.Gates to nGates? idk if any elevation will have more gates than the first
				copied := copy(data[idx:], rad.Gates)

				// pad out to nGates
				// for at least one file i'm testing with, elv 0 has 1832 gates, elv 1 has 1192,
				// then elv 2 is back to 1832, elv 3 back to 1192, etc.
				// would it make more sense to skip the "shorter" ones entirely?
				// esp because at these low elvs we're talking 0.3deg difference,
				// so skipping one doesn't have a great effect on resolution even at 460km out

				// could also interp between above and below?
				for ; copied < nGates; copied++ {
					data[copied] = GateEmptyValue
				}

				idx += copied
			}
		}
	}

	if idx != len(data) {
		panic("Didn't fill data array??")
	}

	tris := mc.MarchingCubesGrid(nGates, nRadials, nElvs, data, threshold)
	for i, tri := range tris {
		tris[i] = mc.Triangle{
			V1: radialToCartesian(tri.V1, elvs),
			V2: radialToCartesian(tri.V2, elvs),
			V3: radialToCartesian(tri.V3, elvs),
		}
	}

	return tris
}

func radialToCartesian(v mc.Vector, elvs ElevationSet) mc.Vector {
	// v.X is gate index
	// v.Y is radial index
	// v.Z is elevation index
	// all can be interpolated (so non-integer indices)

	// Elevation varies enough it's worth it to lerp here
	elvLow := elvs[int(math.Floor(v.Z))].ElevationAngle
	elvHigh := elvs[int(math.Ceil(v.Z))].ElevationAngle
	elvAngle := elvLow + ((elvHigh - elvLow) * (v.Z - math.Floor(v.Z)))

	// Assumes all elevations share the same radial distribution
	// also assumes azimuth resolution is small enough that we don't need to care about
	// interpolating between angles for the floor/ceil indices
	radial := elvs[0].Radials[int(math.Round(v.Y))]
	azimuth := radial.AzimuthAngle

	gateIdx := v.X
	gateDist := radial.StartRange + (gateIdx * radial.GateInterval)

	return mc.Vector{
		X: math.Cos(azimuth*(math.Pi/180.0)) * gateDist,
		Y: math.Sin(azimuth*(math.Pi/180.0)) * gateDist,
		Z: math.Sin(elvAngle*(math.Pi/180.0)) * gateDist,
	}
}

func WriteOBJ(tris []mc.Triangle, w io.Writer) {
	for i, tri := range tris {
		w.Write([]byte(fmt.Sprintf("v %v %v %v\n", tri.V1.X, tri.V1.Y, tri.V1.Z)))
		w.Write([]byte(fmt.Sprintf("v %v %v %v\n", tri.V2.X, tri.V2.Y, tri.V2.Z)))
		w.Write([]byte(fmt.Sprintf("v %v %v %v\n", tri.V3.X, tri.V3.Y, tri.V3.Z)))
		w.Write([]byte(fmt.Sprintf("f %d %d %d\n", i*3+1, i*3+2, i*3+3)))
	}
}
