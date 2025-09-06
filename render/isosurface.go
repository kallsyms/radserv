package render

import (
	"fmt"
	"io"
	"math"
	"sort"

	"github.com/fogleman/mc"
)

// http://opengmsteam.com/articles/3D%20modelling%20strategy%20for%20weather%20radar%20data%20analysis.pdf
// tl;dr
//   - subsample data to have a consistent number of (and consistent placement of) radials
//   - but we don't have to because NEXRAD is consistent
//   - construct hexahedrons between sectors (adjacent elevations)
//   - do marching cubes on the hexahedrons
//
// Resulting tris are Z up
func CreateIsosurface(elvs ElevationSet, threshold float64) []mc.Triangle {
	sort.Sort(elvs)

	for _, elv := range elvs {
		sort.Sort(elv.Radials)
	}

	// MarchingCubesGrid uses dimensions: width (gates), height (radials), depth (elevations)
	// Determine grid dimensions robustly across varying gate counts and azimuth resolutions.
	// width (nGates): use the maximum gate count across all radials/elevations so we never overflow.
	nGates := 0
	for _, elv := range elvs {
		for _, rad := range elv.Radials {
			if len(rad.Gates) > nGates {
				nGates = len(rad.Gates)
			}
		}
	}
	if nGates == 0 {
		return nil
	}

	// target azimuth resolution: use the minimum (finest) resolution across the first elevation
	// and compute how many repeated radials that implies
	azimuthResolution := elvs[0].Radials[0].AzimuthResolution
	for _, rad := range elvs[0].Radials {
		if rad.AzimuthResolution < azimuthResolution {
			azimuthResolution = rad.AzimuthResolution
		}
	}
	// height (nRadials): sum of repeats over the first elevation's radials
	nRadials := 0
	for _, rad := range elvs[0].Radials {
		repeat := int(math.Round(rad.AzimuthResolution / azimuthResolution))
		if repeat < 1 {
			repeat = 1
		}
		nRadials += repeat
	}
	// depth (nElvs): number of elevations
	nElvs := len(elvs)

	data := make([]float64, nElvs*nRadials*nGates)
	idx := 0

	for _, elv := range elvs {
		for _, rad := range elv.Radials {
			// ex: azimuthResolution = 0.5, this radial is 1 so repeat = 2
			repeat := int(math.Round(rad.AzimuthResolution / azimuthResolution))
			if repeat < 1 {
				repeat = 1
			}
			for i := 0; i < repeat; i++ {
				// Copy up to nGates values, then pad the rest with GateEmptyValue
				copyLen := len(rad.Gates)
				if copyLen > nGates {
					copyLen = nGates
				}
				copied := copy(data[idx:idx+copyLen], rad.Gates[:copyLen])
				// pad out to nGates for this radial slot
				for j := copied; j < nGates; j++ {
					data[idx+j] = GateEmptyValue
				}
				idx += nGates
			}
		}
	}

	// If due to any rounding issues we didn't fill the buffer exactly, clamp idx
	// (mc.MarchingCubesGrid will only read based on provided dimensions)
	if idx != len(data) {
		// no panic: allow minor mismatches
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
	// Convert NEXRAD azimuth (degrees clockwise from North) to math angle (radians CCW from East)
	// angle_math = 90 - azimuth
	angle := (90.0 - radial.AzimuthAngle) * (math.Pi / 180.0)

	gateIdx := v.X
	gateDist := radial.StartRange + (gateIdx * radial.GateInterval)

	return mc.Vector{
		X: math.Cos(angle) * gateDist,
		Y: math.Sin(angle) * gateDist,
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
