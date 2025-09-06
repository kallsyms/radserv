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
import ThreeMap from './three/ThreeMap'
import VolumeOverlay from './three/VolumeOverlay'
import IsoOverlayClient from './three/IsoOverlayClient'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildVolumeGrid, type VolumeGrid } from './three/grid'

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
    const l2mode = (p.get('l2mode') === 'archive') ? 'archive' as const : 'realtime'
    const l2date = p.get('l2date') || new Date().toISOString().slice(0,10)
    const l3mode = (p.get('l3mode') === 'archive') ? 'archive' as const : 'realtime'
    const l3date = p.get('l3date') || new Date().toISOString().slice(0,10)
    const seq = (p.get('seq') === '1' || p.get('seq') === 'true')
    const seqlen = (() => { const v = parseInt(p.get('seqlen') || '') ; return isFinite(v) && v > 0 ? Math.min(100, Math.max(1, v)) : 5 })()
    const rock = (p.get('rock') === '1' || p.get('rock') === 'true')
    const fps = (() => { const v = parseFloat(p.get('fps') || '') ; return isFinite(v) ? Math.min(10, Math.max(0.25, v)) : 2 })()
    const seqidx = (() => { const v = parseInt(p.get('seqidx') || '') ; return isFinite(v) && v >= 0 ? v : undefined })()
    return { ds, site, prod, file, elv, auto, base, labels, roads, lat, lon, z, l2mode, l2date, l3mode, l3date, seq, seqlen, rock, fps, seqidx }
  }, [])

  // Store URL params as a ref to prevent re-parsing and maintain initial values
  const urlParams = React.useRef(init)
  
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
  // L2 listing mode state
  const [l2Mode, setL2Mode] = useState<'realtime'|'archive'>(init.l2mode)
  const [l2Date, setL2Date] = useState<string>(init.l2date)
  const [l3Mode, setL3Mode] = useState<'realtime'|'archive'>(init.l3mode)
  const [l3Date, setL3Date] = useState<string>(init.l3date)

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
  // moved up earlier
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
  const [showIso, setShowIso] = useState<boolean>(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    const v = p.get('iso')
    return v === '1' || v === 'true' || false
  })
  const [volumeOpacity, setVolumeOpacity] = useState<number>(0.7)
  // Persisted 3D map view (shared between volume and iso to avoid jumping on toggle)
  const [map3DCenter, setMap3DCenter] = useState<{ lat: number; lon: number } | null>(null)
  const [map3DZoom, setMap3DZoom] = useState<number | null>(null)
  const [isoOpacity, setIsoOpacity] = useState<number>(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const p = new URLSearchParams(raw)
    const v = p.get('iop')
    const f = v ? parseFloat(v) : 0.6
    return isFinite(f) ? Math.max(0, Math.min(1, f)) : 0.6
  })

  const showElevation = dataSource === 'L2' && mode === '2d'

  // Sequence playback state (L2 only)
  const [sequenceEnabled, setSequenceEnabled] = useState<boolean>(init.seq)
  const [sequenceLength, setSequenceLength] = useState<number>(init.seqlen ?? 5)
  const [timelineIndex, setTimelineIndex] = useState<number>(init.seqidx ?? 0)
  const [sequenceFiles, setSequenceFiles] = useState<string[]>([])
  const [seq2DImages, setSeq2DImages] = useState<{ file: string; url: string; loaded: boolean }[]>([])
  const [seq3DGrids, setSeq3DGrids] = useState<Record<string, VolumeGrid>>({})
  const [twoDLoading, setTwoDLoading] = useState<boolean>(false)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [fps, setFps] = useState<number>(init.fps ?? 2)
  const [rock, setRock] = useState<boolean>(init.rock)
  const playDirRef = React.useRef<1 | -1>(1)

  // Playback timer
  useEffect(() => {
    if (!sequenceEnabled || sequenceFiles.length <= 1 || !isPlaying) return
    const interval = Math.max(10, Math.round(1000 / Math.max(0.25, Math.min(10, fps))))
    const id = window.setInterval(() => {
      setTimelineIndex(i => {
        const n = sequenceFiles.length
        if (n <= 1) return i
        let dir: 1 | -1 = playDirRef.current
        let next = i + dir
        if (rock) {
          if (next >= n) { dir = -1; playDirRef.current = dir; next = i + dir }
          if (next < 0) { dir = 1; playDirRef.current = dir; next = i + dir }
        } else {
          if (next >= n) next = 0
          if (next < 0) next = n - 1
        }
        return next
      })
    }, interval)
    return () => window.clearInterval(id)
  }, [isPlaying, fps, sequenceEnabled, sequenceFiles, rock])

  // Stop playback if sequence disabled or not enough frames
  useEffect(() => {
    if (!sequenceEnabled || sequenceFiles.length <= 1) setIsPlaying(false)
  }, [sequenceEnabled, sequenceFiles])

  // Reset direction when starting playback or toggling rock
  useEffect(() => { if (isPlaying) playDirRef.current = 1 }, [isPlaying, rock])

  // Keyboard controls: ArrowLeft/ArrowRight for prev/next frame (wrap)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (dataSource !== 'L2' || !sequenceEnabled || sequenceFiles.length <= 1) return
      // Ignore when typing in inputs/textareas/controls
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        const editable = (target as any).isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
        if (editable) return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.()
        setTimelineIndex(i => (i - 1 + sequenceFiles.length) % sequenceFiles.length)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.()
        setTimelineIndex(i => (i + 1) % sequenceFiles.length)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
  }, [dataSource, sequenceEnabled, sequenceFiles])

  // Load sites when data source changes
  useEffect(() => {
    console.log('Sites loading effect triggered, dataSource:', dataSource)
    // load station coordinates once
    if (!sitesLoaded) {
      loadSiteCoords().then(m => { setSiteCoords(m); setSitesLoaded(true) }).catch(() => setSitesLoaded(true))
    }
    let cancelled = false
    setLoadingSites(true)
    const toDisplayCode = (code: string): string => {
      if (!code) return code
      // For L3, prefer 3-letter core; for L2 keep as-is
      if (dataSource === 'L3') {
        const up = code.toUpperCase()
        if (up.length >= 4 && ['K','P','T'].includes(up[0])) return up.slice(1)
        return up
      }
      return code.toUpperCase()
    }
    const load = async () => {
      try {
        const s = dataSource === 'L2' ? await fetchL2Sites() : await fetchL3Sites()
        if (cancelled) return
        // Fallback: if API returns empty, derive site list from bundled KML
        let siteListRaw = (Array.isArray(s) && s.length > 0)
          ? s
          : Object.keys(siteCoords).filter(k => /^[A-Z0-9]{3,4}$/.test(k))
        // Normalize for display based on data source and dedupe
        let siteList = Array.from(new Set(siteListRaw.map(toDisplayCode)))
        // Ensure URL-specified site is present and first in the list (so it won't be lost)
        const urlSiteRaw = urlParams.current.site
        if (urlSiteRaw) {
          const urlNorm = toDisplayCode(urlSiteRaw)
          const hasUrl = siteList.some(x => x.toUpperCase() === urlNorm.toUpperCase())
          if (!hasUrl) {
            siteList = [urlNorm, ...siteList]
          } else {
            // move url site to front to avoid being replaced by first
            siteList = [siteList.find(x => x.toUpperCase() === urlNorm.toUpperCase())!, ...siteList.filter(x => x.toUpperCase() !== urlNorm.toUpperCase())]
          }
        }
        setSites(siteList)
        // Prefer existing selection from current state if valid; else use URL; else fallback to first
        const listUpper = siteList.map(s => s.toUpperCase())
        const findMatch = (code?: string): string | undefined => {
          if (!code) return undefined
          const up = code.toUpperCase()
          // exact match
          const idxExact = listUpper.indexOf(up)
          if (idxExact !== -1) return siteList[idxExact]
          // normalize to 3-letter core
          const core3 = up.length === 3 ? up : (up.length >= 4 ? up.slice(1) : up)
          // try prefixed 4-letter in list
          for (const pref of ['K','P','T']) {
            const cand = pref + core3
            const i = listUpper.indexOf(cand)
            if (i !== -1) return siteList[i]
          }
          // try 3-letter in list
          const i3 = listUpper.findIndex(s => s === core3)
          if (i3 !== -1) return siteList[i3]
          return undefined
        }
        // Priority: current state site if valid, then URL site if valid, then first in list
        const currentMatch = findMatch(site)
        const urlMatch = findMatch(urlSiteRaw)
        
        console.log('Site selection debug:', {
          currentSite: site,
          urlSiteRaw,
          siteList: siteList.slice(0, 5), // first 5 for brevity
          currentMatch,
          urlMatch
        })
        
        if (currentMatch) {
          // Current state site is valid, keep it
          console.log('Keeping current site:', currentMatch)
          setSite(currentMatch)
        } else if (urlMatch) {
          // URL site is valid, use it
          console.log('Using URL site:', urlMatch)
          setSite(urlMatch)
        } else if (!site) {
          // No current site and no valid URL site, use first as fallback
          console.log('Using fallback (first site):', siteList[0])
          setSite(siteList[0])
        } else {
          console.log('No change to site selection')
        }
        // If we have a current site but it's not in the new list and there's no URL match,
        // keep the current site (don't overwrite with first)
      } catch (e) {
        console.log('Sites loading failed, attempting KML fallback, error:', e)
        // On error, attempt KML-based fallback
        try {
          const kml = await loadSiteCoords()
          if (cancelled) return
          let siteList = Object.keys(kml)
            .filter(k => /^[A-Z0-9]{3,4}$/.test(k))
            .map(toDisplayCode)
            .filter((v, i, a) => a.indexOf(v) === i)
          console.log('KML fallback sites:', siteList.slice(0, 5))
          
          // Apply same logic as main path: respect URL site
          const urlSiteRaw = urlParams.current.site
          if (urlSiteRaw) {
            const urlNorm = toDisplayCode(urlSiteRaw)
            const hasUrl = siteList.some(x => x.toUpperCase() === urlNorm.toUpperCase())
            if (!hasUrl) {
              siteList = [urlNorm, ...siteList]
            } else {
              // move url site to front to avoid being replaced by first
              siteList = [siteList.find(x => x.toUpperCase() === urlNorm.toUpperCase())!, ...siteList.filter(x => x.toUpperCase() !== urlNorm.toUpperCase())]
            }
          }
          
          setSites(siteList)
          
          // Use same findMatch logic for KML fallback
          const listUpper = siteList.map(s => s.toUpperCase())
          const findMatch = (code?: string): string | undefined => {
            if (!code) return undefined
            const up = code.toUpperCase()
            // exact match
            const idxExact = listUpper.indexOf(up)
            if (idxExact !== -1) return siteList[idxExact]
            // normalize to 3-letter core
            const core3 = up.length === 3 ? up : (up.length >= 4 ? up.slice(1) : up)
            // try prefixed 4-letter in list
            for (const pref of ['K','P','T']) {
              const cand = pref + core3
              const i = listUpper.indexOf(cand)
              if (i !== -1) return siteList[i]
            }
            // try 3-letter in list
            const i3 = listUpper.findIndex(s => s === core3)
            if (i3 !== -1) return siteList[i3]
            return undefined
          }
          
          const currentMatch = findMatch(site)
          const urlMatch = findMatch(urlSiteRaw)
          
          console.log('KML fallback site selection:', { currentMatch, urlMatch, fallback: siteList[0] })
          
          if (currentMatch) {
            console.log('KML: Keeping current site:', currentMatch)
            setSite(currentMatch)
          } else if (urlMatch) {
            console.log('KML: Using URL site:', urlMatch)
            setSite(urlMatch)
          } else if (!site) {
            console.log('KML: Using fallback site:', siteList[0])
            setSite(siteList[0])
          } else {
            console.log('KML: No change to site')
          }
        } catch {
          console.log('KML fallback also failed')
          setSites([])
          setSite(undefined)
        }
      } finally {
        if (!cancelled) setLoadingSites(false)
      }
    }
    // Do not reset file/elevation here; let downstream effects handle resets
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

  // Load files when site/product or L2 mode/date changes
  useEffect(() => {
    if (!site) return
    if (dataSource === 'L3' && !product) return
    let cancelled = false
    setLoadingFiles(true)
    const load = async () => {
      try {
        const fs = dataSource === 'L2'
          ? await fetchL2Files(site, l2Mode === 'realtime' ? 'latest' : l2Date.replace(/-/g, ''))
          : await fetchL3Files(site, product, l3Mode === 'realtime' ? 'latest' : l3Date.replace(/-/g, ''))
        if (cancelled) return
        setFiles(fs)
        // Prefer URL-selected file if present
        const urlFile = urlParams.current.file
        
        // Priority: current file if valid, URL file if valid, most recent file
        let newFile: string | undefined
        if (file && fs.includes(file)) {
          newFile = file  // Keep current selection if valid
        } else if (urlFile && fs.includes(urlFile)) {
          newFile = urlFile  // Use URL file if valid
        } else {
          newFile = fs[fs.length - 1]  // Fallback to most recent
        }
        
        // Only update if necessary
        if (newFile !== file) {
          setFile(newFile)
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
  }, [site, product, dataSource, l2Mode, l2Date, l3Mode, l3Date])

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

  // Persist state to URL hash (only once we have a site to avoid wiping selection on boot)
  useEffect(() => {
    if (!site) return
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
    if (mode === '3d' && showIso) p.set('iso', '1')
    if (mode === '3d' && showIso) p.set('iop', String(Math.round(isoOpacity * 100) / 100))
    if (dataSource === 'L2') {
      p.set('l2mode', l2Mode)
      if (l2Mode === 'archive') p.set('l2date', l2Date)
      if (sequenceEnabled) {
        p.set('seq', '1')
        p.set('seqlen', String(sequenceLength))
        if (rock) p.set('rock', '1')
        p.set('fps', String(Math.round(fps * 100) / 100))
        p.set('seqidx', String(timelineIndex))
      }
    } else if (dataSource === 'L3') {
      p.set('l3mode', l3Mode)
      if (l3Mode === 'archive') p.set('l3date', l3Date)
    }
    const newHash = '#' + p.toString()
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash)
    }
  }, [dataSource, site, product, file, elevation, basemap, mapCenter, mapZoom, showLabels, showRoads, mode, effectiveThreshold, showIso, isoOpacity, l2Mode, l2Date, l3Mode, l3Date])

  // Jump to selected site immediately on change (2D + prime 3D view), independent of image load.
  useEffect(() => {
    if (!site) return
    const coord = siteCoords[site]
    if (!coord) return
    // Always recenter 2D map; only bump zoom up if too low
    setMapCenter([coord.lat, coord.lon])
    setMapZoom(z => (z < 7 ? 7 : z))
    // Prime 3D view as well so it doesn't wait for data
    setMap3DCenter({ lat: coord.lat, lon: coord.lon })
    setMap3DZoom(z => (z == null || z < 6 ? 6 : z))
  }, [site, siteCoords])

  // Auto refresh removed

  // image URL for 2D view (respects sequence when enabled)
  const imageUrl = useMemo(() => {
    if (!site || !file) return undefined
    if (dataSource === 'L2') {
      if (sequenceEnabled && mode === '2d' && sequenceFiles.length > 0) {
        const f = sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]
        const elv = elevation || 1
        const prod = (product === 'vel' ? 'vel' : 'ref') as 'ref' | 'vel'
        return l2RenderUrl(site, f, prod, elv)
      }
      const elv = elevation || 1
      const prod = (product === 'vel' ? 'vel' : 'ref') as 'ref' | 'vel'
      return l2RenderUrl(site, file, prod, elv)
    }
    return l3RenderUrl(site, product, file, l3Mode === 'archive' ? l3Date.replace(/-/g, '') : undefined)
  }, [dataSource, site, file, product, elevation, l3Mode, l3Date, sequenceEnabled, sequenceFiles, timelineIndex, mode])

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

  // Update 3D center when using sequence and timeline changes
  const currentSeqFile3D = useMemo(() => {
    if (mode !== '3d' || !sequenceEnabled || sequenceFiles.length === 0) return null
    return sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]
  }, [mode, sequenceEnabled, sequenceFiles, timelineIndex])
  useEffect(() => {
    if (mode !== '3d') return
    if (!site) return
    const f = currentSeqFile3D
    if (!f) return
    fetchL2RadialCenter(site, f).then(setL2Center).catch(() => setL2Center(null))
  }, [mode, site, currentSeqFile3D])

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
  const isoRgba = useMemo(() => {
    const [r,g,b] = isoColor
    return [r, g, b, Math.round(isoOpacity * 255)] as [number, number, number, number]
  }, [isoColor, isoOpacity])

  // (sequence state declared above)

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

  // Compute sequence files when selection/settings change
  useEffect(() => {
    if (!sequenceEnabled || dataSource !== 'L2' || !file || files.length === 0) {
      setSequenceFiles([])
      setTimelineIndex(0)
      return
    }
    const sorted = [...files].sort()
    const idx = sorted.indexOf(file)
    if (idx === -1) { setSequenceFiles([]); setTimelineIndex(0); return }
    const start = Math.max(0, idx - sequenceLength)
    const slice = sorted.slice(start, idx + 1)
    setSequenceFiles(slice)
    const desired = urlParams.current.seqidx
    if (typeof desired === 'number') {
      setTimelineIndex(Math.max(0, Math.min(slice.length - 1, desired)))
    } else {
      setTimelineIndex(slice.length - 1)
    }
  }, [sequenceEnabled, sequenceLength, files, file, dataSource])

  // Preload 2D images for sequence (parallel)
  useEffect(() => {
    if (!sequenceEnabled || mode !== '2d' || dataSource !== 'L2' || !site || sequenceFiles.length === 0) {
      setSeq2DImages([])
      return
    }
    const elv = elevation || 1
    const prod = (product === 'vel' ? 'vel' : 'ref') as 'ref' | 'vel'
    const entries = sequenceFiles.map(f => ({ file: f, url: l2RenderUrl(site, f, prod, elv), loaded: false }))
    setSeq2DImages(entries)
    entries.forEach((ent, i) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => setSeq2DImages(prev => {
        const copy = [...prev]
        if (copy[i] && copy[i].file === ent.file) copy[i] = { ...copy[i], loaded: true }
        return copy
      })
      img.src = ent.url
    })
  }, [sequenceEnabled, mode, dataSource, site, sequenceFiles, elevation, product])

  // Preload 3D grids for sequence (parallel)
  useEffect(() => {
    if (!sequenceEnabled || mode !== '3d' || dataSource !== 'L2' || !site || sequenceFiles.length === 0) {
      setSeq3DGrids({})
      return
    }
    let cancelled = false
    setThreeLoading(true)
    ;(async () => {
      try {
        const pairs = await Promise.all(sequenceFiles.map(async (fn) => {
          try {
            const meta = await fetchL2Meta(site!, fn)
            const elevations = (meta?.ElevationChunks || [])
              .map((arr: number[], idx: number) => (arr && arr.length > 0) ? idx + 1 : 0)
              .filter((e: number) => e > 0)
            const results = await Promise.all(
              elevations.map((elv: number) => fetchL2Radial(site!, fn, 'ref', elv))
            )
            if (cancelled) return [fn, null] as const
            const grid = buildVolumeGrid(results)
            return [fn, grid] as const
          } catch {
            return [fn, null] as const
          }
        }))
        if (cancelled) return
        const obj: Record<string, VolumeGrid> = {}
        for (const [fn, grid] of pairs) if (grid) obj[fn] = grid
        setSeq3DGrids(obj)
      } finally {
        if (!cancelled) setThreeLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sequenceEnabled, mode, dataSource, site, sequenceFiles])

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
          onLoadingChange={(l) => setTwoDLoading(l)}
          showLoadingOverlay={!(dataSource === 'L2' && sequenceEnabled && sequenceFiles.length > 1)}
          crossfadeMs={20}
        />
      ) : (
        <>
          <ThreeMap
            center={l2Center}
            viewCenter={map3DCenter}
            viewZoom={map3DZoom}
            showLabels={showLabels}
            showRoads={showRoads}
            onViewChange={(c, z) => { setMap3DCenter(c); setMap3DZoom(z) }}
          >
            {(map) => (
              <>
                <VolumeOverlay
                  map={map}
                  site={site!}
                  file={(sequenceEnabled && sequenceFiles.length > 0) ? sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))] : file!}
                  center={l2Center}
                  opacity={volumeOpacity}
                  onLoading={setThreeLoading}
                  precomputedGrid={(sequenceEnabled && sequenceFiles.length > 0) ? seq3DGrids[sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]] : undefined}
                />
                {showIso && (
                  <IsoOverlayClient
                    map={map}
                    site={site!}
                    file={(sequenceEnabled && sequenceFiles.length > 0) ? sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))] : file!}
                    threshold={effectiveThreshold}
                    color={isoRgba}
                    center={l2Center}
                    onLoading={setThreeLoading}
                    precomputedGrid={(sequenceEnabled && sequenceFiles.length > 0) ? seq3DGrids[sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]] : undefined}
                  />
                )}
              </>
            )}
          </ThreeMap>
          {threeLoading && !(dataSource === 'L2' && sequenceEnabled && sequenceFiles.length > 1) && (
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
        onDataSourceChange={(v) => {
          // If switching to L3, force 2D mode to avoid 3D->L2 enforcement
          if (v === 'L3' && mode === '3d') setMode('2d')
          setDataSource(v)
        }}

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

        l2Mode={l2Mode}
        onL2ModeChange={(m) => { setL2Mode(m); setFiles([]); setFile(undefined) }}
        l2Date={l2Date}
        onL2DateChange={(d) => { setL2Date(d); setFiles([]); setFile(undefined) }}
        l3Mode={l3Mode}
        onL3ModeChange={(m) => { setL3Mode(m); setFiles([]); setFile(undefined) }}
        l3Date={l3Date}
        onL3DateChange={(d) => { setL3Date(d); setFiles([]); setFile(undefined) }}

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
        showIso={showIso}
        onShowIsoChange={setShowIso}
        volumeOpacity={volumeOpacity}
        onVolumeOpacityChange={setVolumeOpacity}
        isoOpacity={isoOpacity}
        onIsoOpacityChange={setIsoOpacity}
        threshold={threshold}
        onThresholdChange={setThreshold}
        onThresholdCommit={() => {
          if (thresholdTimer.current) {
            window.clearTimeout(thresholdTimer.current)
            thresholdTimer.current = null
          }
          setEffectiveThreshold(threshold)
        }}
        sequenceEnabled={sequenceEnabled}
        onSequenceEnabledChange={(v) => setSequenceEnabled(v)}
        sequenceLength={sequenceLength}
        onSequenceLengthChange={(n) => setSequenceLength(Math.max(1, Math.min(100, n)))}
      />

      {/* Unified loading indicator above frame slider when sequence enabled */}
      {dataSource === 'L2' && sequenceEnabled && sequenceFiles.length > 1 && (
        // Show while any frame in the sequence is still loading (counts) or current overlay loading
        ((mode === '2d' && (seq2DImages.filter(e => e.loaded).length < sequenceFiles.length)) ||
         (mode === '3d' && (Object.keys(seq3DGrids).length < sequenceFiles.length)) ||
         (mode === '2d' && twoDLoading) || (mode === '3d' && threeLoading))
      ) && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1100]">
          <div className="bg-black/60 text-white text-xs rounded-md px-3 py-1 shadow flex items-center gap-2">
            <div className="h-3 w-3 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
            <span>
              {(() => {
                const total = sequenceFiles.length
                const loaded = (mode === '2d')
                  ? seq2DImages.filter(e => e.loaded).length
                  : Object.keys(seq3DGrids).length
                return `Rendering radar… ${loaded}/${total}`
              })()}
            </span>
          </div>
        </div>
      )}

      {dataSource === 'L2' && sequenceEnabled && sequenceFiles.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100]">
          <div className="bg-black/60 text-white text-xs rounded-md px-3 py-2 shadow flex items-center gap-3">
            <button className="px-2 py-1 bg-white/10 rounded" onClick={() => setTimelineIndex(i => (i - 1 + Math.max(1, sequenceFiles.length)) % Math.max(1, sequenceFiles.length))}>Prev</button>
            <button className="px-2 py-1 bg-white/10 rounded" onClick={() => setIsPlaying(p => !p)}>{isPlaying ? 'Pause' : 'Play'}</button>
            <button className="px-2 py-1 bg-white/10 rounded" onClick={() => setTimelineIndex(i => (i + 1) % Math.max(1, sequenceFiles.length))}>Next</button>
            <button className="px-2 py-1 bg-white/10 rounded" onClick={() => setFps(f => Math.max(0.25, Math.round((f - 0.25) * 4) / 4))}>Slow</button>
            <button className="px-2 py-1 bg-white/10 rounded" onClick={() => setFps(f => Math.min(10, Math.round((f + 0.25) * 4) / 4))}>Fast</button>
            <span className="opacity-80">{fps.toFixed(2)}x</span>
            <label className="inline-flex items-center gap-2 opacity-80">
              <input type="checkbox" checked={rock} onChange={e => setRock(e.target.checked)} /> Rock
            </label>
            <span className="opacity-80">Frame</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, sequenceFiles.length - 1)}
              step={1}
              value={timelineIndex}
              onChange={(e) => setTimelineIndex(parseInt(e.target.value))}
              className="w-64"
            />
            <span className="opacity-80 w-12 text-right">{timelineIndex + 1}/{sequenceFiles.length}</span>
            <span className="opacity-80">File</span>
            <span className="font-mono text-[11px] bg-white/10 px-2 py-0.5 rounded max-w-[420px] overflow-hidden text-ellipsis whitespace-nowrap" title={sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]}>
              {sequenceFiles[Math.max(0, Math.min(sequenceFiles.length - 1, timelineIndex))]}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
