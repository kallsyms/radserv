import React, { useEffect, useMemo, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { fetchL2Meta, fetchL2Radial } from '../api/radar'
import type { RadialSet } from '../types'
import { buildVolumeGrid, type VolumeGrid } from './grid'
import { generateIsosurface } from './marchingCubes'

type Props = {
  map: MapLibreMap | null
  site: string
  file: string
  threshold: number
  color: [number, number, number, number]
  center: { lat: number; lon: number } | null
  onLoading: (l: boolean) => void
  precomputedGrid?: VolumeGrid | null
}

export default function IsoOverlayClient({ map, site, file, threshold, color, center, onLoading, precomputedGrid }: Props) {
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const genRef = useRef(0)
  const gridRef = useRef<ReturnType<typeof buildVolumeGrid> | null>(null)
  const layerIdRef = useRef<string>('iso-client-layer')
  const meshRef = useRef<{ positions: Float32Array; indices: Uint32Array } | null>(null)

  // attach overlay control
  useEffect(() => {
    if (!map || overlayRef.current) return
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay)
    overlayRef.current = overlay
    return () => {
      try { map.removeControl(overlay) } catch {}
      overlayRef.current = null
    }
  }, [map])

  // Build grid and first mesh on mount or when site/file changes
  useEffect(() => {
    if (!map || !overlayRef.current || !center) return
    onLoading(true)
    const myGen = ++genRef.current
    const ctrl = new AbortController()
    ;(async () => {
      try {
        let grid: VolumeGrid | null = precomputedGrid ?? null
        if (!grid) {
          const meta = await fetchL2Meta(site, file, ctrl.signal)
          const elevations = (meta?.ElevationChunks || [])
            .map((arr: number[], idx: number) => (arr && arr.length > 0) ? idx + 1 : 0)
            .filter((e: number) => e > 0)
          const results: RadialSet[] = await Promise.all(
            elevations.map((elv: number) => fetchL2Radial(site, file, 'ref', elv, ctrl.signal))
          )
          if (genRef.current !== myGen) return
          grid = buildVolumeGrid(results)
        }
        if (genRef.current !== myGen || !grid) return
        const gridLocal = grid
        gridRef.current = grid
        const mesh = generateIsosurface(gridLocal, threshold)
        meshRef.current = { positions: mesh.positions, indices: mesh.indices }
        const layer = new SimpleMeshLayer({
          id: layerIdRef.current,
          data: [0],
          mesh: {
            attributes: { POSITION: { value: mesh.positions, size: 3 } },
            indices: mesh.indices,
          },
          getPosition: () => [0, 0, 0],
          coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
          coordinateOrigin: [center.lon, center.lat],
          getColor: color,
          opacity: color[3] / 255,
          pickable: false,
          wireframe: false,
          _normalsEnabled: false,
        } as any)
        overlayRef.current!.setProps({ layers: [layer] })
        onLoading(false)
      } catch (e) {
        if (genRef.current === myGen) onLoading(false)
      }
    })()
    return () => { try { ctrl.abort() } catch {} }
  }, [map, site, file, center])

  // Recompute on threshold or center change without refetching
  useEffect(() => {
    const overlay = overlayRef.current
    const grid = gridRef.current
    if (!overlay || !center || !grid) return
    onLoading(true)
    const mesh = generateIsosurface(grid, threshold)
    meshRef.current = { positions: mesh.positions, indices: mesh.indices }
    const layer = new SimpleMeshLayer({
      id: layerIdRef.current,
      data: [0],
      mesh: {
        attributes: { POSITION: { value: mesh.positions, size: 3 } },
        indices: mesh.indices,
      },
      getPosition: () => [0, 0, 0],
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [center.lon, center.lat],
      getColor: color,
      opacity: color[3] / 255,
      pickable: false,
      wireframe: false,
      _normalsEnabled: false,
    } as any)
    overlay.setProps({ layers: [layer] })
    onLoading(false)
  }, [threshold, center])

  // Restyle only when color/opacity changes
  useEffect(() => {
    const overlay = overlayRef.current
    const mesh = meshRef.current
    if (!overlay || !center || !mesh) return
    const layer = new SimpleMeshLayer({
      id: layerIdRef.current,
      data: [0],
      mesh: {
        attributes: { POSITION: { value: mesh.positions, size: 3 } },
        indices: mesh.indices,
      },
      getPosition: () => [0, 0, 0],
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [center.lon, center.lat],
      getColor: color,
      opacity: color[3] / 255,
      pickable: false,
      wireframe: false,
      _normalsEnabled: false,
    } as any)
    overlay.setProps({ layers: [layer] })
  }, [color, center])

  return null
}
