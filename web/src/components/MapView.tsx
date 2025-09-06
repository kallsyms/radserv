import { MapContainer, TileLayer, ImageOverlay, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import { LatLngBoundsExpression } from 'leaflet'
import React from 'react'

const CONUS_BOUNDS: LatLngBoundsExpression = [
  [25, -125], // SW
  [50, -65],  // NE
]

type Props = {
  imageUrl?: string
  opacity?: number
  basemap?: 'satellite' | 'osm'
  center: [number, number]
  zoom: number
  onViewChange: (center: [number, number], zoom: number) => void
  showLabels?: boolean
  showRoads?: boolean
}

function ViewSync({ center, zoom, onViewChange }: { center: [number, number], zoom: number, onViewChange: (c:[number,number], z:number)=>void }) {
  const map = useMap()
  // Apply incoming center/zoom if they diverge from current view
  React.useEffect(() => {
    const cur = map.getCenter()
    const cz = map.getZoom()
    const sameCenter = Math.abs(cur.lat - center[0]) < 1e-6 && Math.abs(cur.lng - center[1]) < 1e-6
    const sameZoom = Math.abs(cz - zoom) < 1e-6
    if (!sameCenter || !sameZoom) {
      // Smoothly fly to the requested center/zoom
      map.flyTo({ lat: center[0], lng: center[1] }, zoom, { animate: true, duration: 0.8 })
    }
  }, [center, zoom, map])

  useMapEvents({
    moveend() {
      const c = map.getCenter()
      onViewChange([c.lat, c.lng], map.getZoom())
    },
    zoomend() {
      const c = map.getCenter()
      onViewChange([c.lat, c.lng], map.getZoom())
    }
  })
  return null
}

function Panes() {
  const map = useMap()
  React.useEffect(() => {
    // Create custom panes to allow styling (e.g., background color) per layer group
    if (!map.getPane('base')) {
      const p = map.createPane('base')
      p.style.zIndex = '200'
    }
    if (!map.getPane('radar')) {
      const p = map.createPane('radar')
      p.style.zIndex = '350'
    }
    if (!map.getPane('labels')) {
      const p = map.createPane('labels')
      p.style.zIndex = '400'
      p.style.pointerEvents = 'none'
    }
    if (!map.getPane('roads')) {
      const p = map.createPane('roads')
      p.style.zIndex = '401'
      p.style.pointerEvents = 'none'
    }
  }, [map])
  return null
}

export default function MapView({ imageUrl, opacity = 0.9, basemap = 'satellite', center, zoom, onViewChange, showLabels = true, showRoads = false }: Props) {
  const [imageLoading, setImageLoading] = React.useState(false)
  React.useEffect(() => {
    if (imageUrl) setImageLoading(true)
    else setImageLoading(false)
  }, [imageUrl])
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={3}
      maxZoom={11}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <ZoomControl position="bottomleft" />
      <Panes />
      <ViewSync center={center} zoom={zoom} onViewChange={onViewChange} />
      {basemap === 'satellite' ? (
        <TileLayer
          attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a>'
          url='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          tileSize={256}
          maxNativeZoom={19}
          maxZoom={11}
          detectRetina={true}
          pane='base'
        />
      ) : (
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          tileSize={256}
          maxNativeZoom={19}
          maxZoom={11}
          detectRetina={true}
          pane='base'
        />
      )}
      {basemap === 'satellite' && showLabels && (
        <TileLayer
          attribution='Labels & Boundaries &copy; Esri'
          url='https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
          tileSize={256}
          maxNativeZoom={19}
          maxZoom={11}
          detectRetina={true}
          pane='labels'
        />
      )}
      {basemap === 'satellite' && showRoads && (
        <TileLayer
          attribution='Transportation &copy; Esri'
          url='https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
          tileSize={256}
          maxNativeZoom={19}
          // Limit to lower zooms where tiles show only major roads
          maxZoom={12}
          detectRetina={true}
          pane='roads'
        />
      )}
      {imageUrl && (
        <ImageOverlay
          key={imageUrl}
          url={imageUrl}
          bounds={CONUS_BOUNDS}
          opacity={opacity}
          crossOrigin={true as any}
          className="radar-img"
          pane='radar'
          eventHandlers={{
            load: () => setImageLoading(false),
            error: () => setImageLoading(false),
          }}
        />
      )}
      {imageLoading && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100]">
          <div className="bg-black/60 text-white text-xs rounded-md px-3 py-1 shadow flex items-center gap-2">
            <div className="h-3 w-3 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
            <span>Rendering radar…</span>
          </div>
        </div>
      )}
    </MapContainer>
  )
}
