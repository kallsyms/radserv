import React, { useEffect, useRef } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'

const ESRI_IMG = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ROADS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

type Props = {
  center: { lat: number; lon: number } | null
  viewCenter?: { lat: number; lon: number } | null
  viewZoom?: number | null
  showLabels: boolean
  showRoads: boolean
  onViewChange?: (center: { lat: number; lon: number }, zoom: number) => void
  children?: (map: MapLibreMap | null) => React.ReactNode
}

export default function ThreeMap({ center, viewCenter = null, viewZoom = null, showLabels, showRoads, onViewChange, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const firstFitRef = useRef(true)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const style: any = {
      version: 8,
      sources: {
        esri: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, attribution: 'Imagery © Esri' },
        labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, attribution: 'Labels © Esri' },
        roads: { type: 'raster', tiles: [ESRI_ROADS], tileSize: 256, attribution: 'Roads © Esri' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1221' } },
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
      // Start almost top-down to better inspect radar overlays
      pitch: 15,
      maxZoom: 11,
      minZoom: 3,
      attributionControl: true,
    })
    mapRef.current = map
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
    return () => {
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle overlays visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('labels')) map.setLayoutProperty('labels', 'visibility', showLabels ? 'visible' : 'none')
    if (map.getLayer('roads')) map.setLayoutProperty('roads', 'visibility', showRoads ? 'visible' : 'none')
  }, [showLabels, showRoads])

  // If no persisted view, optionally ease to radar center once when provided
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    if (viewCenter) return
    if (!firstFitRef.current) return
    firstFitRef.current = false
    map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 6), duration: 400 })
  }, [center, viewCenter])

  return (
    <div className="absolute inset-0" ref={containerRef}>
      {children?.(mapRef.current) || null}
    </div>
  )
}
