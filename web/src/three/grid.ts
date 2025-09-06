// Utilities to assemble a 3D scalar grid from multiple RadialSet elevations
// Mirrors logic in server-side render/isosurface.go

import type { RadialSet } from '../types'

export const GATE_EMPTY_VALUE = -9999

export type VolumeGrid = {
  // Dimensions: width (gates), height (radials), depth (elevations)
  dims: [number, number, number]
  // Float32 values of size dims[0] * dims[1] * dims[2]
  data: Float32Array
  // Metadata for coordinate conversion
  elevationAngles: number[]
  // For simplicity assume uniform azimuth distribution derived from first elevation
  azimuthResolution: number
  startRange: number
  gateInterval: number
  // Azimuth angles for each normalized radial slot (length dims[1])
  azimuthSlots: number[]
}

export function sortElevations(elvs: RadialSet[]): RadialSet[] {
  return [...elvs].sort((a, b) => a.ElevationAngle - b.ElevationAngle)
}

export function buildVolumeGrid(elevations: RadialSet[]): VolumeGrid {
  if (!elevations.length) throw new Error('No elevations provided')
  const elvs = sortElevations(elevations)

  // Max gates across all radials/elevations
  let nGates = 0
  for (const elv of elvs) {
    for (const rad of elv.Radials) {
      if (rad.Gates.length > nGates) nGates = rad.Gates.length
    }
  }
  if (nGates === 0) throw new Error('No gates found')

  // Determine finest azimuth resolution from first elevation
  let azimuthResolution = elvs[0].Radials[0]?.AzimuthResolution ?? 1
  for (const rad of elvs[0].Radials) {
    if (rad.AzimuthResolution < azimuthResolution) azimuthResolution = rad.AzimuthResolution
  }

  // Compute number of radial slots (sum of repeats across first elevation) and capture per-slot azimuth.
  // These slots define a common azimuth grid that all elevations will be mapped into.
  let nRadials = 0
  const azimuthSlots: number[] = []
  for (const rad of elvs[0].Radials) {
    let repeat = Math.round(rad.AzimuthResolution / azimuthResolution)
    if (repeat < 1) repeat = 1
    for (let i = 0; i < repeat; i++) azimuthSlots.push(rad.AzimuthAngle + i * azimuthResolution)
    nRadials += repeat
  }
  const nElvs = elvs.length

  const total = nGates * nRadials * nElvs
  const data = new Float32Array(total)
  // Fill the 3D grid by mapping each elevation's radials into the common azimuth slots
  data.fill(GATE_EMPTY_VALUE)
  for (let ez = 0; ez < nElvs; ez++) {
    const elv = elvs[ez]
    for (const rad of elv.Radials) {
      let repeat = Math.round(rad.AzimuthResolution / azimuthResolution)
      if (repeat < 1) repeat = 1
      // Determine the slot index for this radial's starting azimuth relative to slot[0]
      const baseAz = azimuthSlots[0]
      let slot = Math.round(((rad.AzimuthAngle - baseAz) / azimuthResolution))
      slot = ((slot % nRadials) + nRadials) % nRadials
      for (let r = 0; r < repeat; r++) {
        const y = (slot + r) % nRadials
        const rowOffset = ez * (nGates * nRadials) + y * nGates
        const copyLen = Math.min(rad.Gates.length, nGates)
        for (let j = 0; j < copyLen; j++) data[rowOffset + j] = rad.Gates[j]
        // remaining cells are already GATE_EMPTY_VALUE
      }
    }
  }

  const elevationAngles = elvs.map(e => e.ElevationAngle)
  // Use the first elevation to get typical startRange and gateInterval (moments are uniform per elevation)
  const firstRad = elvs[0].Radials[0]
  return {
    dims: [nGates, nRadials, nElvs],
    data,
    elevationAngles,
    azimuthResolution,
    startRange: firstRad?.StartRange ?? 0,
    gateInterval: firstRad?.GateInterval ?? 250,
    azimuthSlots,
  }
}
