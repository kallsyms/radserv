import type { L2Meta } from '../types'

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || ''

// L2 endpoints
export async function fetchL2Sites(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/l2`)
  if (!res.ok) throw new Error('Failed to fetch L2 sites')
  return res.json()
}

export async function fetchL2Files(site: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/l2/${encodeURIComponent(site)}`)
  if (!res.ok) throw new Error('Failed to fetch L2 files')
  return res.json()
}

export async function fetchL2Meta(site: string, fn: string): Promise<L2Meta> {
  const res = await fetch(`${API_BASE}/l2/${encodeURIComponent(site)}/${encodeURIComponent(fn)}`)
  if (!res.ok) throw new Error('Failed to fetch L2 meta')
  return res.json()
}

export function l2RenderUrl(site: string, fn: string, product: 'ref' | 'vel', elv: number): string {
  return `${API_BASE}/l2/${encodeURIComponent(site)}/${encodeURIComponent(fn)}/${product}/${elv}/render`
}

// L3 endpoints
export async function fetchL3Sites(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/l3`)
  if (!res.ok) throw new Error('Failed to fetch L3 sites')
  return res.json()
}

export async function fetchL3Products(site: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/l3/${encodeURIComponent(site)}`)
  if (!res.ok) throw new Error('Failed to fetch L3 products')
  return res.json()
}

export async function fetchL3Files(site: string, product: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/l3/${encodeURIComponent(site)}/${encodeURIComponent(product)}`)
  if (!res.ok) throw new Error('Failed to fetch L3 files')
  return res.json()
}

export function l3RenderUrl(site: string, product: string, fn: string): string {
  return `${API_BASE}/l3/${encodeURIComponent(site)}/${encodeURIComponent(product)}/${encodeURIComponent(fn)}/render`
}

// L2 radial for center lat/lon (use ref/1, metadata identical for center across products)
export async function fetchL2RadialCenter(site: string, fn: string): Promise<{ lat: number; lon: number }> {
  const res = await fetch(`${API_BASE}/l2/${encodeURIComponent(site)}/${encodeURIComponent(fn)}/ref/1/radial`)
  if (!res.ok) throw new Error('Failed to fetch L2 radial meta')
  const data = await res.json()
  return { lat: data.Lat, lon: data.Lon }
}

// Fetch full radial set JSON for a specific elevation
export async function fetchL2Radial(
  site: string,
  fn: string,
  product: 'ref' | 'vel',
  elv: number
): Promise<import('../types').RadialSet> {
  const res = await fetch(`${API_BASE}/l2/${encodeURIComponent(site)}/${encodeURIComponent(fn)}/${product}/${elv}/radial`)
  if (!res.ok) throw new Error(`Failed to fetch L2 radial for elv ${elv}`)
  return res.json()
}
