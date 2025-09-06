// Web Worker for isosurface generation
// Receives a packed grid and threshold, returns positions + indices
// This file runs in a worker context

/// <reference lib="webworker" />

import { generateIsosurface } from './marchingCubes'

type PackedGrid = {
  dims: [number, number, number]
  data: ArrayBuffer
  elevationAngles: number[]
  azimuthSlots: number[]
  azimuthResolution: number
  startRange: number
  gateInterval: number
}

type IsoRequest = { id: number; type: 'iso'; grid: PackedGrid; threshold: number }
type IsoResponse = { id: number; positions: ArrayBuffer; indices: ArrayBuffer }

function unpackGrid(pg: PackedGrid) {
  return {
    dims: pg.dims as [number, number, number],
    data: new Float32Array(pg.data),
    elevationAngles: pg.elevationAngles,
    azimuthSlots: pg.azimuthSlots,
    azimuthResolution: pg.azimuthResolution,
    startRange: pg.startRange,
    gateInterval: pg.gateInterval,
  }
}

self.onmessage = (e: MessageEvent<IsoRequest>) => {
  const msg = e.data
  if (!msg || msg.type !== 'iso') return
  const grid = unpackGrid(msg.grid) as any
  const mesh = generateIsosurface(grid, msg.threshold)
  const out: IsoResponse = {
    id: msg.id,
    positions: mesh.positions.buffer,
    indices: mesh.indices.buffer,
  }
  // Transfer buffers to avoid copying
  ;(self as any).postMessage(out, [out.positions, out.indices])
}

