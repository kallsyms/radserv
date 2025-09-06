import React, { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Controls from './components/Controls'
import type { DataSource } from './types'
import {
  fetchL2Files,
  fetchL2Meta,
  fetchL2Sites,
  fetchL3Files,
  fetchL3Products,
  fetchL3Sites,
  l2RenderUrl,
  l3RenderUrl,
} from './api/radar'
import { loadSiteCoords, type SiteCoordMap } from './utils/sites'

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
    const auto = (p.get('auto') === '1' || p.get('auto') === 'true')
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

  const [autoRefresh, setAutoRefresh] = useState<boolean>(init.auto)
  const [basemap, setBasemap] = useState<'satellite' | 'osm'>(init.base)
  const [mapCenter, setMapCenter] = useState<[number, number]>([init.lat, init.lon])
  const [mapZoom, setMapZoom] = useState<number>(init.z)
  const [siteCoords, setSiteCoords] = useState<SiteCoordMap>({})
  const [sitesLoaded, setSitesLoaded] = useState(false)
  const [showLabels, setShowLabels] = useState<boolean>(init.labels)
  const [showRoads, setShowRoads] = useState<boolean>(init.roads)

  const showElevation = dataSource === 'L2'

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
    if (autoRefresh) p.set('auto', '1')
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
    const newHash = '#' + p.toString()
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash)
    }
  }, [dataSource, site, product, file, elevation, autoRefresh, basemap, mapCenter, mapZoom, showLabels, showRoads])

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

  // Auto refresh latest file
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(async () => {
      if (!site) return
      try {
        const fs = dataSource === 'L2' ? await fetchL2Files(site) : await fetchL3Files(site!, product)
        const latest = fs[fs.length - 1]
        if (latest && latest !== file) setFile(latest)
      } catch {}
    }, 60000)
    return () => clearInterval(id)
  }, [autoRefresh, dataSource, site, product, file])

  const imageUrl = useMemo(() => {
    if (!site || !file) return undefined
    if (dataSource === 'L2') {
      const elv = elevation || 1
      const prod = (product === 'vel' ? 'vel' : 'ref') as 'ref' | 'vel'
      return l2RenderUrl(site, file, prod, elv)
    }
    return l3RenderUrl(site, product, file)
  }, [dataSource, site, file, product, elevation])

  return (
    <div className="h-full w-full">
      <MapView
        imageUrl={imageUrl}
        basemap={basemap}
        center={mapCenter}
        zoom={mapZoom}
        onViewChange={(c, z) => { setMapCenter(c); setMapZoom(z) }}
        showLabels={showLabels}
        showRoads={showRoads}
      />
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

        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}

        basemap={basemap}
        onBasemapChange={setBasemap}
        showLabels={showLabels}
        onShowLabelsChange={setShowLabels}
        showRoads={showRoads}
        onShowRoadsChange={setShowRoads}
      />
    </div>
  )
}
