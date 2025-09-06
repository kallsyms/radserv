import React from 'react'
import type { DataSource, ViewMode } from '../types'

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

  // L2 listing mode
  l2Mode?: 'realtime' | 'archive'
  onL2ModeChange?: (v: 'realtime' | 'archive') => void
  l2Date?: string // YYYY-MM-DD for input[type=date]
  onL2DateChange?: (v: string) => void
  // L3 listing mode
  l3Mode?: 'realtime' | 'archive'
  onL3ModeChange?: (v: 'realtime' | 'archive') => void
  l3Date?: string // YYYY-MM-DD
  onL3DateChange?: (v: string) => void

  elevations: number[]
  elevation?: number
  onElevationChange: (v: number) => void
  loadingElevations?: boolean

  showElevation: boolean

  basemap: 'satellite' | 'osm'
  onBasemapChange: (v: 'satellite' | 'osm') => void
  showLabels: boolean
  onShowLabelsChange: (v: boolean) => void
  showRoads: boolean
  onShowRoadsChange: (v: boolean) => void
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
  showIso: boolean
  onShowIsoChange: (v: boolean) => void
  volumeOpacity?: number
  onVolumeOpacityChange?: (v: number) => void
  isoOpacity?: number
  onIsoOpacityChange?: (v: number) => void
  threshold: number
  onThresholdChange: (v: number) => void
  onThresholdCommit: () => void
}

export default function Controls(props: Props) {
  const sortedSites = React.useMemo(() => {
    return [...props.sites].sort((a, b) => a.localeCompare(b))
  }, [props.sites])
  return (
    <div className="absolute top-4 left-4 z-[1000] bg-white/70 dark:bg-gray-900/60 backdrop-blur-md backdrop-saturate-150 rounded-xl shadow-lg ring-1 ring-black/10 dark:ring-white/10 p-3 space-y-3 w-[360px] text-gray-900 dark:text-gray-100">
      {/* Level */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Level</div>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Data</label>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <button
              className={`px-2 py-1 rounded border text-sm ${props.dataSource==='L2'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onDataSourceChange('L2')}
            >L2</button>
            <button
              className={`px-2 py-1 rounded border text-sm ${props.dataSource==='L3'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onDataSourceChange('L3')}
            >L3</button>
          </div>
        </div>
      </div>

      

      {/* File */}
      <div className="space-y-2 pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">File</div>
      <div className="flex gap-2 items-center">
        <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Site</label>
        <select
          className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          value={props.site || ''}
          onChange={e => props.onSiteChange(e.target.value)}
          disabled={props.loadingSites || props.sites.length === 0}
        >
          {sortedSites.map(s => <option key={s} value={s}>{s}</option>)}
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

      {props.dataSource === 'L2' && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">L2 Mode</label>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <button
              className={`px-2 py-1 rounded border text-sm ${props.l2Mode==='realtime'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onL2ModeChange && props.onL2ModeChange('realtime')}
            >Realtime</button>
            <button
              className={`px-2 py-1 rounded border text-sm ${props.l2Mode==='archive'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onL2ModeChange && props.onL2ModeChange('archive')}
            >Archive</button>
          </div>
        </div>
      )}

      {props.dataSource === 'L2' && props.l2Mode === 'archive' && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Date</label>
          <input
            type="date"
            className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
            value={props.l2Date || ''}
            onChange={e => props.onL2DateChange && props.onL2DateChange(e.target.value)}
          />
        </div>
      )}

      {props.dataSource === 'L3' && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">L3 Mode</label>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <button
              className={`px-2 py-1 rounded border text-sm ${props.l3Mode==='realtime'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onL3ModeChange && props.onL3ModeChange('realtime')}
            >Realtime</button>
            <button
              className={`px-2 py-1 rounded border text-sm ${props.l3Mode==='archive'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
              onClick={() => props.onL3ModeChange && props.onL3ModeChange('archive')}
            >Archive</button>
          </div>
        </div>
      )}

      {props.dataSource === 'L3' && props.l3Mode === 'archive' && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Date</label>
          <input
            type="date"
            className="flex-1 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
            value={props.l3Date || ''}
            onChange={e => props.onL3DateChange && props.onL3DateChange(e.target.value)}
          />
        </div>
      )}

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
      </div>

      {/* Visualization */}
      <div className="space-y-2 pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Visualization</div>
        {props.dataSource === 'L2' && (
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Mode</label>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <button
                className={`px-2 py-1 rounded border text-sm ${props.mode==='2d'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
                onClick={() => props.onModeChange('2d')}
              >2D</button>
              <button
                className={`px-2 py-1 rounded border text-sm ${props.mode==='3d'?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}
                onClick={() => props.onModeChange('3d')}
              >3D</button>
            </div>
          </div>
        )}

      {props.dataSource === 'L2' && props.mode === '3d' && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-600 dark:text-gray-300 w-24">IsoSurface</label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={props.showIso} onChange={e => props.onShowIsoChange(e.target.checked)} />
              Show inside volume
            </label>
          </div>
          {props.showIso && (
            <div className="pl-24 space-y-2">
              <div className="flex gap-2 items-center">
                <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Threshold</label>
                <input
                  type="range"
                  min={5}
                  max={75}
                  step={5}
                  value={props.threshold}
                  onChange={e => props.onThresholdChange(parseInt(e.target.value))}
                  onMouseUp={props.onThresholdCommit}
                  onTouchEnd={props.onThresholdCommit}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0}
                  max={80}
                  step={1}
                  value={props.threshold}
                  onChange={e => props.onThresholdChange(parseInt(e.target.value))}
                  onBlur={props.onThresholdCommit}
                  className="w-16 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              {props.onIsoOpacityChange && (
                <div className="flex gap-2 items-center">
                  <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Iso Opacity</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((props.isoOpacity ?? 0.6) * 100)}
                    onChange={e => props.onIsoOpacityChange!(parseInt(e.target.value) / 100)}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={(props.isoOpacity ?? 0.6).toFixed(2)}
                    onChange={e => props.onIsoOpacityChange!(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                    className="w-16 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {props.dataSource === 'L2' && props.mode === '3d' && props.onVolumeOpacityChange && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-600 dark:text-gray-300 w-24">Opacity</label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((props.volumeOpacity ?? 0.7) * 100)}
            onChange={e => props.onVolumeOpacityChange!(parseInt(e.target.value) / 100)}
            className="flex-1"
          />
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={(props.volumeOpacity ?? 0.7).toFixed(2)}
            onChange={e => props.onVolumeOpacityChange!(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
            className="w-16 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
      )}

      

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
    </div>
  )
}
