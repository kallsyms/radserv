// Load NEXRAD site coordinates from the KML bundled at /nexrad.kml
// Builds a map for both 4-letter codes (e.g., KOKX) and 3-letter codes (e.g., OKX)

export type SiteCoordMap = Record<string, { lat: number; lon: number }>

let cache: Promise<SiteCoordMap> | null = null

export async function loadSiteCoords(): Promise<SiteCoordMap> {
  if (cache) return cache
  cache = (async () => {
    const res = await fetch('/nexrad.kml')
    if (!res.ok) return {}
    const text = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'application/xml')
    const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'))
    const map: SiteCoordMap = {}
    for (const pm of placemarks) {
      const descEl = pm.getElementsByTagNameNS('*', 'description')[0]
      const coordEl = pm.getElementsByTagNameNS('*', 'coordinates')[0]
      if (!descEl || !coordEl) continue
      const desc = descEl.textContent || ''
      const m = desc.match(/SITE ID\s+NEXRAD:([A-Z0-9]{4})/i)
      if (!m) continue
      const code4 = m[1].toUpperCase()
      const [lonStr, latStr] = (coordEl.textContent || '').trim().split(',')
      const lon = parseFloat(lonStr)
      const lat = parseFloat(latStr)
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        map[code4] = { lat, lon }
        // also index 3-letter without leading K/P/T for Level 3 usage
        if (/^[KPT]/.test(code4) && code4.length === 4) {
          const code3 = code4.slice(1)
          map[code3] = { lat, lon }
        }
      }
    }
    return map
  })()
  return cache
}

