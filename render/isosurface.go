package render

type Point struct {
	// east/west
	X float64
	// north/south
	Y float64
	// elevation
	Z float64
}

func pointFrom(elv *RadialSet, radial *Radial, gateIdx int) Point {
}

// Assumes elvs are sorted lowest to highest
func CreateMesh(elvs []*RadialSet, thresholds []float64) []Point {
	minThreshold := thresholds[0]
	for _, t := range thresholds {
		if t < minThreshold {
			minThreshold = t
		}
	}

	points := []Point{}

	// for each elv, radial, gate: if the current gate's value is > threshold and the one we're comparing against isn't,
	// add the current point to the point cloud.
	for elvIdx, elv := range elvs {
		prevElvIdx := elvIdx - 1
		if elvIdx == 0 {
			prevElvIdx = 0
		}
		prevElv := elvs[prevElvIdx]
		nextElvIdx := elvIdx + 1
		if nextElvIdx == len(elvs) {
			nextElvIdx = len(elvs) - 1
		}
		nextElv := elvs[nextElvIdx]

		for radialIdx, radial := range elv.Radials {
			prevRadialIdx := radialIdx - 1
			if radialIdx == 0 {
				prevRadialIdx = len(elv.Radials) - 1
			}
			prevRadial := elv.Radials[prevRadialIdx]
			nextRadialIdx := (radialIdx + 1) % len(elv.Radials)
			nextRadial := elv.Radials[nextRadialIdx]

			for gateIdx, gate := range radial.Gates {
				if gate < minThreshold {
					continue
				}

				// for each threshold that this gate is less than
				for _, threshold := range thresholds {
					if gate < threshold {
						continue
					}

					// Above some threshold, now see if this is the first point past the threshold
					// Need to check one over in each direction, e.g. if we're on x, each * in:
					//    * *
					//    |/
					// *--x--*
					//   /|
					//  * *

					// Check prev gate
					// First gate should be a part of the point cloud if past the threshold
					if gateIdx == 0 || radial.Gates[gateIdx-1] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}

					// Check next gate
					// Last gate should be a part of the point cloud if past the threshold
					if gateIdx == len(radial.Gates)-1 || radial.Gates[gateIdx+1] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}

					// Check prev radial, wrapping around if idx == 0
					if prevRadial.Gates[gateIdx] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}

					// Check next radial, wrapping around if idx == len - 1
					if nextRadial.Gates[gateIdx] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}

					// Check prev elv
					// If this gate in the first elevation is > threshold, it should be a part of the cloud regardless
					if elvIdx == 0 || prevElv.Radials[radialIdx].Gates[gateIdx] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}

					// Check next elv
					if elvIdx == len(elvs)-1 || nextElv.Radials[radialIdx].Gates[gateIdx] < threshold {
						points = append(points, pointFrom(elv, radial, gateIdx))
						break
					}
				}
			}
		}
	}

	return points
}
