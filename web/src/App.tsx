import React, { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Controls from './components/Controls'
import type { DataSource, ViewMode } from './types'
import {
  fetchL2Files,
  fetchL2Meta,
  fetchL2Sites,
  fetchL3Files,
  fetchL3Products,
  fetchL3Sites,
  l2RenderUrl,
  l3RenderUrl,
  fetchL2RadialCenter,
} from './api/radar'
import { loadSiteCoords, type SiteCoordMap } from './utils/sites'
import IsoView3D from './three/IsoView3D'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function App() {
  // Parse initial state from URL hash
  const init = React.useMemo(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    const ds = (p.get('src') as DataSource) || 'L2'
    const site = p.get('site') || undefined
    const prod = p.get('prod') || (ds === 'L2' ? 'ref' : '')
    const file = p.get('file') || undefined
    const elvStr = p.get('elv')
    const elv = elvStr ? parseInt(elvStr) : undefined
    const auto = false
    const base = (p.get('base') as 'satellite' | 'osm') || 'satellite'
    const labels = (p.get('labels') === '1' || p.get('labels') === 'true')
    const roads = (p.get('roads') === '1' || p.get('roads') === 'true')
    const lat = p.get('lat') ? parseFloat(p.get('lat')!) : 39
    const lon = p.get('lon') ? parseFloat(p.get('lon')!) : -98
    const z = p.get('z') ? parseFloat(p.get('z')!) : 4
    return { ds, site, prod, file, elv, auto, base, labels, roads, lat, lon, z }
  }, [])

  const [dataSource, setDataSource] = useState<DataSource>(init.ds as DataSource)

  const [sites, setSites] = useState<string[]>([])
  const [site, setSite] = useState<string | undefined>(init.site)
  const [loadingSites, setLoadingSites] = useState(false)

  const [products, setProducts] = useState<string[]>(dataSource === 'L2' ? ['ref', 'vel'] : [])
  const [product, setProduct] = useState<string>(init.prod)
  const [loadingProducts, setLoadingProducts] = useState(false)

  const [files, setFiles] = useState<string[]>([])
  const [file, setFile] = useState<string | undefined>(init.file)
  const [loadingFiles, setLoadingFiles] = useState(false)

  const [elevations, setElevations] = useState<number[]>([])
  const [elevation, setElevation] = useState<number | undefined>(init.elv)
  const [loadingElevations, setLoadingElevations] = useState(false)

  // auto refresh removed; files are immutable once uploaded
  const [basemap, setBasemap] = useState<'satellite' | 'osm'>(init.base)
  const [mapCenter, setMapCenter] = useState<[number, number]>([init.lat, init.lon])
  const [mapZoom, setMapZoom] = useState<number>(init.z)
  const [siteCoords, setSiteCoords] = useState<SiteCoordMap>({})
  const [sitesLoaded, setSitesLoaded] = useState(false)
  const [showLabels, setShowLabels] = useState<boolean>(init.labels)
  const [showRoads, setShowRoads] = useState<boolean>(init.roads)
  const [mode, setMode] = useState<ViewMode>(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    return (p.get('mode') as ViewMode) || '2d'
  })
  const [threshold, setThreshold] = useState<number>(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    return p.get('thr') ? parseInt(p.get('thr')!) : 40
  })
  const [effectiveThreshold, setEffectiveThreshold] = useState<number>(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    return p.get('thr') ? parseInt(p.get('thr')!) : 40
  })
  const thresholdTimer = React.useRef<number | null>(null)
  const [l2Center, setL2Center] = useState<{ lat: number; lon: number } | null>(null)
  const [threeLoading, setThreeLoading] = useState(false)

  const showElevation = dataSource === 'L2' && mode === '2d'

  // Load sites when data source changes
  useEffect(() => {
    // load station coordinates once
    if (!sitesLoaded) {
      loadSiteCoords().then(m => { setSiteCoords(m); setSitesLoaded(true) }).catch(() => setSitesLoaded(true))
    }
    let cancelled = false
    setLoadingSites(true)
    const load = async () => {
      try {
        const s = dataSource === 'L2' ? await fetchL2Sites() : await fetchL3Sites()
        if (cancelled) return
        setSites(s)
        // Prefer existing selection from URL if available
        if (site && s.includes(site)) {
          setSite(site)
        } else {
          setSite(s[0])
        }
      } catch (e) {
        setSites([])
        setSite(undefined)
      } finally {
        if (!cancelled) setLoadingSites(false)
      }
    }
    // reset dependent state
    setFiles([]); setFile(undefined)
    setElevations([]); setElevation(undefined)
    if (dataSource === 'L2') {
      setProducts(['ref', 'vel'])
      // honor existing product if valid, else default to ref
      setProduct((product === 'vel' || product === 'ref') ? product : 'ref')
    } else {
      setProducts([])
      setProduct(product || '')
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource])

  // Load products for L3 when site changes
  useEffect(() => {
    if (!site) return
    if (dataSource !== 'L3') return
    let cancelled = false
    setLoadingProducts(true)
    const load = async () => {
      try {
        const ps = await fetchL3Products(site)
        if (cancelled) return
        setProducts(ps)
        if (product && ps.includes(product)) {
          setProduct(product)
        } else {
          setProduct(ps[0])
        }
      } catch (e) {
        setProducts([])
        setProduct('')
      } finally {
        if (!cancelled) setLoadingProducts(false)
      }
    }
    // reset files/elevations on site change
    setFiles([]); setFile(undefined)
    setElevations([]); setElevation(undefined)
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, dataSource])

  // Load files when site or product changes
  useEffect(() => {
    if (!site) return
    if (dataSource === 'L3' && !product) return
    let cancelled = false
    setLoadingFiles(true)
    const load = async () => {
      try {
        const fs = dataSource === 'L2'
          ? await fetchL2Files(site)
          : await fetchL3Files(site, product)
        if (cancelled) return
        setFiles(fs)
        if (file && fs.includes(file)) {
          setFile(file)
        } else {
          setFile(fs[fs.length - 1])
        }
      } catch (e) {
        setFiles([])
        setFile(undefined)
      } finally {
        if (!cancelled) setLoadingFiles(false)
      }
    }
    // reset downstream selections
    setElevations([]); setElevation(undefined)
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, product, dataSource])

  // Load elevations for L2 when file changes
  useEffect(() => {
    if (!site || !file) return
    if (dataSource !== 'L2') return
    let cancelled = false
    setLoadingElevations(true)
    const load = async () => {
      try {
        const meta = await fetchL2Meta(site, file)
        if (cancelled) return
        const elevs = (meta?.ElevationChunks || [])
          .map((arr, idx) => (arr && arr.length > 0) ? idx + 1 : 0)
          .filter(e => e > 0)
        setElevations(elevs)
        if (elevation && elevs.includes(elevation)) {
          setElevation(elevation)
        } else {
          setElevation(elevs[0] || 1)
        }
      } catch (e) {
        setElevations([1])
        setElevation(1)
      } finally {
        if (!cancelled) setLoadingElevations(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, file, dataSource])

  // Persist state to URL hash
  useEffect(() => {
    const p = new URLSearchParams()
    p.set('src', dataSource)
    if (site) p.set('site', site)
    if (product) p.set('prod', product)
    if (file) p.set('file', file)
    if (elevation) p.set('elv', String(elevation))
    // auto refresh removed
    if (basemap) p.set('base', basemap)
    if (showLabels) p.set('labels', '1')
    if (showRoads) p.set('roads', '1')
    if (mapCenter) {
      p.set('lat', mapCenter[0].toFixed(5))
      p.set('lon', mapCenter[1].toFixed(5))
    }
    if (mapZoom !== undefined) {
      p.set('z', String(Math.round(mapZoom * 100) / 100))
    }
    p.set('mode', mode)
    if (mode === '3d') p.set('thr', String(effectiveThreshold))
    const newHash = '#' + p.toString()
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash)
    }
  }, [dataSource, site, product, file, elevation, basemap, mapCenter, mapZoom, showLabels, showRoads, mode, effectiveThreshold])

  // Auto-jump to selected site when zoomed out enough.
  // If zoomed in beyond 7, don't move. If at/below 7, recenter; if below 7, also zoom to 7.
  useEffect(() => {
    if (!site) return
    const coord = siteCoords[site]
    if (!coord) return
    if (mapZoom > 7) return
    setMapCenter([coord.lat, coord.lon])
    if (mapZoom < 7) setMapZoom(7)
  }, [site, siteCoords, mapZoom])

  // Auto refresh removed

  const imageUrl = useMemo(() => {
    if (!site || !file) return undefined
    if (dataSource === 'L2') {
      const elv = elevation || 1
      const prod = (product === 'vel' ? 'vel' : 'ref') as 'ref' | 'vel'
      return l2RenderUrl(site, file, prod, elv)
    }
    return l3RenderUrl(site, product, file)
  }, [dataSource, site, file, product, elevation])

  // Ensure 3D mode uses L2 + ref and fetch center
  useEffect(() => {
    if (mode !== '3d') return
    if (dataSource !== 'L2') setDataSource('L2')
    if (product !== 'ref') setProduct('ref')
  }, [mode])

  useEffect(() => {
    if (mode !== '3d') return
    if (!site || !file) return
    fetchL2RadialCenter(site, file).then(setL2Center).catch(() => setL2Center(null))
  }, [mode, site, file])

  function dbzColorNOAA(dbz: number): [number, number, number] {
    if (dbz < 5.0) return [0x00,0x00,0x00]
    else if (dbz < 10.0) return [0x40,0xe8,0xe3]
    else if (dbz < 15.0) return [0x26,0xa4,0xfa]
    else if (dbz < 20.0) return [0x00,0x30,0xed]
    else if (dbz < 25.0) return [0x49,0xfb,0x3e]
    else if (dbz < 30.0) return [0x36,0xc2,0x2e]
    else if (dbz < 35.0) return [0x27,0x8c,0x1e]
    else if (dbz < 40.0) return [0xfe,0xf5,0x43]
    else if (dbz < 45.0) return [0xeb,0xb4,0x33]
    else if (dbz < 50.0) return [0xf6,0x95,0x2e]
    else if (dbz < 55.0) return [0xf8,0x0a,0x26]
    else if (dbz < 60.0) return [0xcb,0x05,0x16]
    else if (dbz < 65.0) return [0xa9,0x08,0x13]
    else if (dbz < 70.0) return [0xee,0x34,0xfa]
    else if (dbz < 75.0) return [0x91,0x61,0xc4]
    return [0xff,0xff,0xff]
  }
  const isoColor: [number, number, number, number] = useMemo(() => {
    const [r,g,b] = dbzColorNOAA(effectiveThreshold)
    return [r, g, b, Math.round(0.5 * 255)]
  }, [effectiveThreshold])

  // Debounce threshold changes: fire after 2s or on commit
  useEffect(() => {
    if (mode !== '3d') return
    if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current)
    thresholdTimer.current = window.setTimeout(() => {
      setEffectiveThreshold(threshold)
      thresholdTimer.current = null
    }, 2000)
    return () => {
      if (thresholdTimer.current) {
        window.clearTimeout(thresholdTimer.current)
        thresholdTimer.current = null
      }
    }
  }, [threshold, mode])

  return (
    <div className="h-full w-full">
      {mode === '2d' ? (
        <MapView
          imageUrl={imageUrl}
          basemap={basemap}
          center={mapCenter}
          zoom={mapZoom}
          onViewChange={(c, z) => { setMapCenter(c); setMapZoom(z) }}
          showLabels={showLabels}
          showRoads={showRoads}
        />
      ) : (
        <>
          <IsoView3D
            site={site!}
            file={file!}
            threshold={effectiveThreshold}
            color={isoColor}
            center={l2Center}
            showLabels={showLabels}
            showRoads={showRoads}
            onLoading={setThreeLoading}
          />
          {threeLoading && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100]">
              <div className="bg-black/60 text-white text-xs rounded-md px-3 py-1 shadow flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
                <span>Rendering radar…</span>
              </div>
            </div>
          )}
        </>
      )}
      <Controls
        dataSource={dataSource}
        onDataSourceChange={setDataSource}

        sites={sites}
        site={site}
        onSiteChange={setSite}
        loadingSites={loadingSites}

        products={products}
        product={product}
        onProductChange={setProduct}
        loadingProducts={loadingProducts}

        files={files}
        file={file}
        onFileChange={setFile}
        loadingFiles={loadingFiles}

        elevations={elevations}
        elevation={elevation}
        onElevationChange={setElevation}
        loadingElevations={loadingElevations}
        showElevation={showElevation}

        basemap={basemap}
        onBasemapChange={setBasemap}
        showLabels={showLabels}
        onShowLabelsChange={setShowLabels}
        showRoads={showRoads}
        onShowRoadsChange={setShowRoads}
        mode={mode}
        onModeChange={(m) => {
          setMode(m)
          if (m === '3d') {
            setDataSource('L2')
            setProduct('ref')
          }
        }}
        threshold={threshold}
        onThresholdChange={setThreshold}
        onThresholdCommit={() => {
          if (thresholdTimer.current) {
            window.clearTimeout(thresholdTimer.current)
            thresholdTimer.current = null
          }
          setEffectiveThreshold(threshold)
        }}
      />
    </div>
  )
}
