import React from 'react'
import type { DataSource } from '../types'

type Props = {
  dataSource: DataSource
  onDataSourceChange: (v: DataSource) => void

  sites: string[]
  site?: string
  onSiteChange: (v: string) => void
  loadingSites?: boolean

  products: string[]
  product?: string
  onProductChange: (v: string) => void
  loadingProducts?: boolean

  files: string[]
  file?: string
  onFileChange: (v: string) => void
  loadingFiles?: boolean

  elevations: number[]
  elevation?: number
  onElevationChange: (v: number) => void
  loadingElevations?: boolean

  showElevation: boolean

  autoRefresh: boolean
  onAutoRefreshChange: (v: boolean) => void

  basemap: 'satellite' | 'osm'
  onBasemapChange: (v: 'satellite' | 'osm') => void
  showLabels: boolean
  onShowLabelsChange: (v: boolean) => void
  showRoads: boolean
  onShowRoadsChange: (v: boolean) => void
}

export default function Controls(props: Props) {
  return (
    <div className="absolute top-4 left-4 z-[1000] bg-white/70 dark:bg-gray-900/60 backdrop-blur-md backdrop-saturate-150 rounded-xl shadow-lg ring-1 ring-black/10 dark:ring-white/10 p-3 space-y-2 w-[340px] text-gray-900 dark:text-gray-100">
      <div className="flex gap-2">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Data Source</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.dataSource}
          onChange={e => props.onDataSourceChange(e.target.value as any)}
        >
          <option value="L2">L2</option>
          <option value="L3">L3</option>
        </select>
      </div>

      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Site</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.site || ''}
          onChange={e => props.onSiteChange(e.target.value)}
          disabled={props.loadingSites || props.sites.length === 0}
        >
          {props.sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {props.loadingSites && <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>}
      </div>

      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Product</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.product || ''}
          onChange={e => props.onProductChange(e.target.value)}
          disabled={props.loadingProducts || props.products.length === 0}
        >
          {props.products.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {props.loadingProducts && <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>}
      </div>

      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">File</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.file || ''}
          onChange={e => props.onFileChange(e.target.value)}
          disabled={props.loadingFiles || props.files.length === 0}
        >
          {props.files.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {props.loadingFiles && <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>}
      </div>

      {props.showElevation && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Elevation</label>
          <select
            className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
            value={props.elevation || ''}
            onChange={e => props.onElevationChange(parseInt(e.target.value))}
            disabled={props.loadingElevations || props.elevations.length === 0}
          >
            {props.elevations.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          {props.loadingElevations && <span className="text-xs text-gray-500 dark:text-gray-400">Loading…</span>}
        </div>
      )}

      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Auto Refresh</label>
        <input
          type="checkbox"
          checked={props.autoRefresh}
          onChange={e => props.onAutoRefreshChange(e.target.checked)}
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">every 60s</span>
      </div>

      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Base Layer</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.basemap}
          onChange={e => props.onBasemapChange(e.target.value as any)}
        >
          <option value="satellite">Satellite (Esri)</option>
          <option value="osm">Streets (OSM)</option>
        </select>
      </div>

      {props.basemap === 'satellite' && (
        <div className="flex gap-3 items-center pl-24 -mt-1">
          <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={props.showLabels} onChange={e => props.onShowLabelsChange(e.target.checked)} />
            Labels/Boundaries
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={props.showRoads} onChange={e => props.onShowRoadsChange(e.target.checked)} />
            Roads
          </label>
        </div>
      )}
    </div>
  )
}
