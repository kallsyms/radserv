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
  onLoadingChange?: (loading: boolean) => void
  showLoadingOverlay?: boolean
  crossfadeMs?: number
  loaderDebounceMs?: number
  keepPreviousWhileLoading?: boolean
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
      map.setView({ lat: center[0], lng: center[1] }, zoom, { animate: false })
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

export default function MapView({ imageUrl, opacity = 0.9, basemap = 'satellite', center, zoom, onViewChange, showLabels = true, showRoads = false, onLoadingChange, showLoadingOverlay = true, crossfadeMs = 20, loaderDebounceMs = 150, keepPreviousWhileLoading = true }: Props) {
  // Double-buffer overlays to avoid blanking: keep base visible until top is loaded, then crossfade
  const [baseUrl, setBaseUrl] = React.useState<string | undefined>(imageUrl)
  const [topUrl, setTopUrl] = React.useState<string | undefined>(undefined)
  const [topOpacity, setTopOpacity] = React.useState(0)
  const fadeRef = React.useRef<number | null>(null)
  const showTimerRef = React.useRef<number | null>(null)
  const fetchCtrlRef = React.useRef<AbortController | null>(null)
  const createdBlobUrlsRef = React.useRef<Set<string>>(new Set())
  const [loadingActive, setLoadingActive] = React.useState(false)
  const [loadingVisible, setLoadingVisible] = React.useState(false)

  // Handle new image requests
  React.useEffect(() => {
    if (!imageUrl) {
      setBaseUrl(undefined)
      setTopUrl(undefined)
      setTopOpacity(0)
      setLoadingActive(false)
      if (showTimerRef.current) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null }
      setLoadingVisible(false)
      onLoadingChange && onLoadingChange(false)
      return
    }
    // First image ever
    if (!baseUrl) {
      setBaseUrl(imageUrl)
      setTopUrl(undefined)
      setTopOpacity(0)
      return
    }
    // If the requested image is already the base, nothing to do
    if (imageUrl === baseUrl) return
    // Abort any in-flight fetch for prior top
    try { fetchCtrlRef.current?.abort() } catch {}
    // Optionally clear base immediately to avoid ambiguity when target isn't loaded yet
    if (!keepPreviousWhileLoading) setBaseUrl(undefined)
    setTopUrl(undefined)
    setTopOpacity(0)
    setLoadingActive(true)
    if (showTimerRef.current) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null }
    showTimerRef.current = window.setTimeout(() => {
      setLoadingVisible(true)
      onLoadingChange && onLoadingChange(true)
      showTimerRef.current = null
    }, loaderDebounceMs)

    // Fetch the image manually so we can cancel if source changes quickly
    const ctrl = new AbortController()
    fetchCtrlRef.current = ctrl
    ;(async () => {
      try {
        const res = await fetch(imageUrl, { signal: ctrl.signal, cache: 'force-cache' })
        if (!res.ok) throw new Error('image fetch failed')
        const blob = await res.blob()
        const objUrl = URL.createObjectURL(blob)
        createdBlobUrlsRef.current.add(objUrl)
        // Set as top URL (ImageOverlay will trigger load event promptly)
        setTopUrl(objUrl)
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return
        // Error: clear loading state
        setLoadingActive(false)
        if (showTimerRef.current) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null }
        if (loadingVisible) { setLoadingVisible(false); onLoadingChange && onLoadingChange(false) }
      }
    })()
  }, [imageUrl])

  React.useEffect(() => () => {
    if (fadeRef.current) cancelAnimationFrame(fadeRef.current)
    try { fetchCtrlRef.current?.abort() } catch {}
    // Revoke created blob URLs
    createdBlobUrlsRef.current.forEach(u => { try { URL.revokeObjectURL(u) } catch {} })
    createdBlobUrlsRef.current.clear()
  }, [])
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
      {/* Base overlay stays visible during loading */}
      {baseUrl && (
        <ImageOverlay
          key={`base:${baseUrl}`}
          url={baseUrl}
          bounds={CONUS_BOUNDS}
          opacity={opacity}
          crossOrigin={true as any}
          className="radar-img"
          pane='radar'
        />
      )}
      {/* Top overlay fades in once loaded, then becomes new base */}
      {topUrl && (
        <ImageOverlay
          key={`top:${topUrl}`}
          url={topUrl}
          bounds={CONUS_BOUNDS}
          opacity={Math.max(0, Math.min(1, topOpacity)) * opacity}
          crossOrigin={true as any}
          className="radar-img"
          pane='radar'
          eventHandlers={{
            load: () => {
              // Fade in
              const start = performance.now()
              const step = (t: number) => {
                const dt = Math.min(1, (t - start) / Math.max(1, crossfadeMs))
                setTopOpacity(dt)
                if (dt < 1) {
                  fadeRef.current = requestAnimationFrame(step)
                } else {
                  // Promote to base and clear top
                  // Revoke previous base if it was a blob URL
                  if (baseUrl && createdBlobUrlsRef.current.has(baseUrl)) {
                    try { URL.revokeObjectURL(baseUrl) } catch {}
                    createdBlobUrlsRef.current.delete(baseUrl)
                  }
                  setBaseUrl(topUrl)
                  setTopUrl(undefined)
                  setTopOpacity(0)
                  setLoadingActive(false)
                  if (showTimerRef.current) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null }
                  if (loadingVisible) {
                    setLoadingVisible(false)
                    onLoadingChange && onLoadingChange(false)
                  }
                }
              }
              fadeRef.current = requestAnimationFrame(step)
            },
            error: () => {
              // On error, just swap immediately
              if (baseUrl && createdBlobUrlsRef.current.has(baseUrl)) {
                try { URL.revokeObjectURL(baseUrl) } catch {}
                createdBlobUrlsRef.current.delete(baseUrl)
              }
              setBaseUrl(topUrl)
              setTopUrl(undefined)
              setTopOpacity(0)
              setLoadingActive(false)
              if (showTimerRef.current) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null }
              if (loadingVisible) {
                setLoadingVisible(false)
                onLoadingChange && onLoadingChange(false)
              }
            },
          }}
        />
      )}
      {loadingVisible && showLoadingOverlay && (
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
