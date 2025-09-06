export type DataSource = 'L2' | 'L3'

export interface L2Meta {
  ElevationChunks: number[][]
}

export type ViewMode = '2d' | '3d'

// JSON shape returned by /l2/:site/:fn/:product/:elv/radial
export interface Radial {
  AzimuthAngle: number
  AzimuthResolution: number
  StartRange: number
  GateInterval: number
  Gates: number[]
}

export interface RadialSet {
  Lat: number
  Lon: number
  Radius: number
  ElevationAngle: number
  Radials: Radial[]
}
