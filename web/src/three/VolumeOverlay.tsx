import React, { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { fetchL2Meta, fetchL2Radial } from '../api/radar'
import type { RadialSet } from '../types'
import { buildVolumeGrid, type VolumeGrid } from './grid'
import { makeVolumeLayer } from './VolumeView3D'

type Props = {
  map: MapLibreMap | null
  site: string
  file: string
  center: { lat: number; lon: number } | null
  opacity?: number
  onLoading: (l: boolean) => void
  precomputedGrid?: VolumeGrid | null
}

export default function VolumeOverlay({ map, site, file, center, opacity = 0.7, onLoading, precomputedGrid }: Props) {
  const [gridState, setGridState] = useState<ReturnType<typeof buildVolumeGrid> | null>(null)
  const layerIdRef = useRef<string>('volume-layer')
  const layerRef = useRef<any | null>(null)

  useEffect(() => {
    if (!map || !site || !file) return
    let cancelled = false
    onLoading(true)
    ;(async () => {
      try {
        let grid: VolumeGrid | null = precomputedGrid ?? null
        if (!grid) {
          const meta = await fetchL2Meta(site, file)
          const elevations = (meta?.ElevationChunks || [])
            .map((arr: number[], idx: number) => (arr && arr.length > 0) ? idx + 1 : 0)
            .filter((e: number) => e > 0)
          const results: RadialSet[] = await Promise.all(
            elevations.map((elv: number) => fetchL2Radial(site, file, 'ref', elv))
          )
          if (cancelled) return
          grid = buildVolumeGrid(results)
        }
        if (cancelled || !grid) return
        setGridState(grid)
        const id = layerIdRef.current
        if (map.getLayer(id)) map.removeLayer(id)
        // determine origin: prefer provided center; else from first result; else map center
        let originLon = center?.lon
        let originLat = center?.lat
        if (originLon === undefined || originLat === undefined) {
          // Use map center if not provided; precomputed grid lacks lon/lat context
          const cFromData = null as any
          originLon = originLon ?? cFromData?.lon ?? map.getCenter().lng
          originLat = originLat ?? cFromData?.lat ?? map.getCenter().lat
        }
        const custom: any = makeVolumeLayer(id, () => gridState || grid!, [originLon as number, originLat as number], opacity)
        layerRef.current = custom
        map.addLayer(custom)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e)
      } finally {
        if (!cancelled) onLoading(false)
      }
    })()
    return () => {
      cancelled = true
      const id = layerIdRef.current
      try { if (map.getLayer(id)) map.removeLayer(id) } catch {}
      layerRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, site, file, precomputedGrid])

  // Opacity updates: adjust uniform via layer method without rebuilding
  useEffect(() => {
    if (!map || !layerRef.current) return
    try { layerRef.current.setOpacity?.(Math.max(0, Math.min(1, opacity))) } catch {}
    try { (map as any).triggerRepaint?.() } catch {}
  }, [opacity, map])

  return null
}
