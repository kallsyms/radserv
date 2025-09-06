import React, { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { OBJLoader } from '@loaders.gl/obj'
import { load } from '@loaders.gl/core'
import { COORDINATE_SYSTEM } from '@deck.gl/core'

export type Iso3DProps = {
  site: string
  file: string
  threshold: number
  color: [number, number, number, number]
  center: { lat: number; lon: number } | null
  showLabels: boolean
  showRoads: boolean
  onLoading: (loading: boolean) => void
}

const ESRI_IMG = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ROADS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

export default function IsoView3D({ site, file, threshold, color, center, showLabels, showRoads, onLoading }: Iso3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [initialized, setInitialized] = useState(false)
  const genRef = useRef(0)

  // init maplibre
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
      center: center ? [center.lon, center.lat] : [-98, 39],
      zoom: 5,
      pitch: 60,
      maxZoom: 11,
      minZoom: 3,
      attributionControl: true,
    })
    mapRef.current = map
    overlayRef.current = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlayRef.current)
    setInitialized(true)
    return () => {
      if (overlayRef.current) {
        try { map.removeControl(overlayRef.current as any) } catch {}
        overlayRef.current = null
      }
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // toggle overlays visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('labels')) map.setLayoutProperty('labels', 'visibility', showLabels ? 'visible' : 'none')
    if (map.getLayer('roads')) map.setLayoutProperty('roads', 'visibility', showRoads ? 'visible' : 'none')
  }, [showLabels, showRoads])

  // load/isplay isosurface
  useEffect(() => {
    const map = mapRef.current
    if (!map || !overlayRef.current || !center) return
    // Clear previous layer and mark loading
    overlayRef.current.setProps({ layers: [] })
    onLoading(true)
    // API route: /l2/:site/:fn/:product/isosurface/:threshold (no elevation segment)
    const url = `/l2/${encodeURIComponent(site)}/${encodeURIComponent(file)}/ref/isosurface/${encodeURIComponent(String(threshold))}`
    const myGen = ++genRef.current
    load(url, OBJLoader).then((mesh: any) => {
      if (genRef.current !== myGen) return
      const layer = new SimpleMeshLayer({
        id: `isosurface-layer-${myGen}`,
        data: [0],
        mesh,
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
      // optional: fit view on first load/change
      if (center) {
        map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 6), duration: 400 })
      }
    }).catch(() => {
      if (genRef.current === myGen) onLoading(false)
    })
    // nothing to cleanup beyond deck overlay replacement
  }, [site, file, threshold, center])

  // Fly to center as soon as it changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 6), duration: 600 })
  }, [center])

  return <div ref={containerRef} className="absolute inset-0" />
}
