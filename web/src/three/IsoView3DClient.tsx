import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { fetchL2Meta, fetchL2Radial } from '../api/radar'
import type { RadialSet } from '../types'
import { buildVolumeGrid } from './grid'
import { generateIsosurface } from './marchingCubes'

export type Iso3DClientProps = {
  site: string
  file: string
  threshold: number
  color: [number, number, number, number]
  center: { lat: number; lon: number } | null
  viewCenter?: { lat: number; lon: number } | null
  viewZoom?: number | null
  showLabels: boolean
  showRoads: boolean
  onLoading: (loading: boolean) => void
  onViewChange?: (center: { lat: number; lon: number }, zoom: number) => void
}

const ESRI_IMG = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ROADS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

export default function IsoView3DClient({ site, file, threshold, color, center, viewCenter = null, viewZoom = null, showLabels, showRoads, onLoading, onViewChange }: Iso3DClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [initialized, setInitialized] = useState(false)
  const genRef = useRef(0)
  const gridRef = useRef<ReturnType<typeof buildVolumeGrid> | null>(null)
  const layerIdRef = useRef<string>('iso-client-layer')
  const workerRef = useRef<Worker | null>(null)
  const taskIdRef = useRef(0)
  // Keep latest center/color in refs to avoid stale closures inside worker onmessage
  const centerRef = useRef<Iso3DClientProps['center']>(center)
  const colorRef = useRef<Iso3DClientProps['color']>(color)
  // Track last posted job to avoid redundant worker work (only threshold+center matter)
  const lastJobRef = useRef<{ thr: number; center: string } | null>(null)
  // Cache last geometry for restyling without recomputation
  const meshRef = useRef<{ positions: Float32Array; indices: Uint32Array } | null>(null)
  // Track whether a recompute is in-flight; used to defer color updates
  const inFlightRef = useRef(false)

  useEffect(() => { centerRef.current = center }, [center])
  useEffect(() => { colorRef.current = color }, [color])

  useEffect(() => {
    if (!containerRef.current || initialized) return
    const style: any = {
      version: 8,
      sources: {
        esri: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, attribution: 'Imagery © Esri' },
        labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, attribution: 'Labels © Esri' },
        roads: { type: 'raster', tiles: [ESRI_ROADS], tileSize: 256, attribution: 'Roads © Esri' },
      },
      layers: [
        { id: 'esri', type: 'raster', source: 'esri' },
        { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: showLabels ? 'visible' : 'none' } },
        { id: 'roads', type: 'raster', source: 'roads', layout: { visibility: showRoads ? 'visible' : 'none' } },
      ],
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: (viewCenter || center) ? [
        (viewCenter || center)!.lon,
        (viewCenter || center)!.lat,
      ] : [-98, 39],
      zoom: viewZoom ?? 5,
      pitch: 60,
      maxZoom: 11,
      minZoom: 3,
      attributionControl: true,
    })
    mapRef.current = map
    overlayRef.current = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlayRef.current)
    setInitialized(true)
    // propagate view changes to parent
    map.on('moveend', () => {
      if (!onViewChange) return
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng }, map.getZoom())
    })
    map.on('zoomend', () => {
      if (!onViewChange) return
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng }, map.getZoom())
    })
    // spin up worker for iso generation
    try {
      workerRef.current = new Worker(new URL('./isoWorker.ts', import.meta.url), { type: 'module' })
      workerRef.current.onmessage = (ev: MessageEvent<any>) => {
        const { id, positions, indices } = ev.data || {}
        if (id !== taskIdRef.current) return
        try { console.log('iso worker result', id, positions?.byteLength || 0, indices?.byteLength || 0) } catch {}
        const map = mapRef.current
        const overlay = overlayRef.current
        const curCenter = centerRef.current
        const curColor = colorRef.current
        if (!map || !overlay || !curCenter) return
        const pos = new Float32Array(positions)
        const idx = new Uint32Array(indices)
        meshRef.current = { positions: pos, indices: idx }
        const mesh = {
          attributes: { POSITION: { value: pos, size: 3 } },
          indices: idx,
        }
        const lid = layerIdRef.current
        const layer = new SimpleMeshLayer({
          id: lid,
          data: [0],
          mesh,
          getPosition: () => [0, 0, 0],
          coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
          coordinateOrigin: [curCenter.lon, curCenter.lat],
          getColor: curColor,
          opacity: curColor[3] / 255,
          pickable: false,
          wireframe: false,
          _normalsEnabled: false,
        } as any)
        overlay.setProps({ layers: [layer] })
        try { console.log('Iso3DClient: worker result applied, set loading=false') } catch {}
        inFlightRef.current = false
        onLoading(false)
      }
      workerRef.current.onerror = (err: any) => {
        try { console.error('iso worker error', err?.message || err) } catch {}
        inFlightRef.current = false
        onLoading(false)
      }
      ;(workerRef.current as any).onmessageerror = (err: any) => {
        try { console.error('iso worker message error', err?.message || err) } catch {}
        inFlightRef.current = false
        onLoading(false)
      }
    } catch {}
    return () => {
      if (overlayRef.current) {
        try { map.removeControl(overlayRef.current as any) } catch {}
        overlayRef.current = null
      }
      map.remove()
      mapRef.current = null
      if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null }
      // Ensure spinner clears if component unmounts while loading
      inFlightRef.current = false
      onLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('labels')) map.setLayoutProperty('labels', 'visibility', showLabels ? 'visible' : 'none')
    if (map.getLayer('roads')) map.setLayoutProperty('roads', 'visibility', showRoads ? 'visible' : 'none')
  }, [showLabels, showRoads])

  // Build grid client-side (fetch once per site/file)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !overlayRef.current || !center) return
    try { console.log('Iso3DClient: building grid, set loading=true') } catch {}
    onLoading(true)
    const myGen = ++genRef.current
    ;(async () => {
      try {
        const meta = await fetchL2Meta(site, file)
        const elevations = (meta?.ElevationChunks || [])
          .map((arr: number[], idx: number) => (arr && arr.length > 0) ? idx + 1 : 0)
          .filter((e: number) => e > 0)
        const results: RadialSet[] = await Promise.all(
          elevations.map((elv: number) => fetchL2Radial(site, file, 'ref', elv))
        )
        if (genRef.current !== myGen) return
        const grid = buildVolumeGrid(results)
        gridRef.current = grid
        const mesh = generateIsosurface(grid, threshold)
        meshRef.current = { positions: mesh.positions, indices: mesh.indices }
        if (mesh.positions.length === 0) {
          console.warn('Iso: empty mesh (no crossings at threshold)')
        }
        if (genRef.current !== myGen) return
        const layer = new SimpleMeshLayer({
          id: layerIdRef.current,
          data: [0],
          mesh: {
            attributes: {
              POSITION: { value: mesh.positions, size: 3 },
            },
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
        try { console.log('Iso3DClient: grid built + mesh, set loading=false') } catch {}
        onLoading(false)
        // If parent hasn't provided a persisted view, optionally fit to radar center once
        if (!viewCenter && center) {
          map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 6), duration: 400 })
        }
      } catch (e) {
        if (genRef.current === myGen) { try { console.log('Iso3DClient: grid build error, set loading=false') } catch {}; onLoading(false) }
      }
    })()
  }, [site, file, center])

  // Recompute iso on threshold/center change without refetching (use worker to avoid jank)
  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    const grid = gridRef.current
    if (!map || !overlay || !center || !grid) return
    // Avoid redundant posts if nothing materially changed (ignore color-only changes)
    const jobKey = { thr: threshold, center: `${center.lat.toFixed(6)},${center.lon.toFixed(6)}` }
    const last = lastJobRef.current
    if (last && last.thr === jobKey.thr && last.center === jobKey.center) {
      return
    }
    lastJobRef.current = jobKey
    const id = ++taskIdRef.current
    try { console.log('Iso3DClient: posting worker job', { id, threshold }) } catch {}
    inFlightRef.current = true
    onLoading(true)
    const copied = grid.data.buffer.slice(0)
    const pg = {
      dims: grid.dims,
      data: copied,
      elevationAngles: grid.elevationAngles,
      azimuthSlots: grid.azimuthSlots,
      azimuthResolution: grid.azimuthResolution,
      startRange: grid.startRange,
      gateInterval: grid.gateInterval,
    }
    if (workerRef.current) {
      try { console.log('iso worker post (update)', id, threshold) } catch {}
      workerRef.current.postMessage({ id, type: 'iso', grid: pg, threshold })
    } else {
      const mesh = generateIsosurface(grid, threshold)
      meshRef.current = { positions: mesh.positions, indices: mesh.indices }
      const lid = layerIdRef.current
      const layer = new SimpleMeshLayer({
        id: lid,
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
      try { console.log('Iso3DClient: worker result applied, set loading=false') } catch {}
      inFlightRef.current = false
      onLoading(false)
    }
  }, [threshold, center])

  // If only color/opacity changes, update layer without recomputing geometry
  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    const curCenter = centerRef.current
    const curMesh = meshRef.current
    if (!map || !overlay || !curCenter || !curMesh) return
    // If a recompute is in-flight, do not update the existing mesh color.
    // We want the old mesh to keep its old color until the new mesh is ready.
    if (inFlightRef.current) return
    const layer = new SimpleMeshLayer({
      id: layerIdRef.current,
      data: [0],
      mesh: {
        attributes: { POSITION: { value: curMesh.positions, size: 3 } },
        indices: curMesh.indices,
      },
      getPosition: () => [0, 0, 0],
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [curCenter.lon, curCenter.lat],
      getColor: color,
      opacity: color[3] / 255,
      pickable: false,
      wireframe: false,
      _normalsEnabled: false,
    } as any)
    overlay.setProps({ layers: [layer] })
  }, [color])

  return <div ref={containerRef} className="absolute inset-0" />
}
