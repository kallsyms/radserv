// Marching Tetrahedra implementation over a scalar VolumeGrid to generate an isosurface
// Produces a non-indexed triangle list (positions) and sequential indices

import type { VolumeGrid } from './grid'

export type MeshData = { positions: Float32Array; indices: Uint32Array }

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

export function generateIsosurface(grid: VolumeGrid, threshold: number): MeshData {
  const [nx, ny, nz] = grid.dims
  const strideX = 1
  const strideY = nx
  const strideZ = nx * ny
  const data = grid.data

  function sample(x: number, y: number, z: number): number {
    return data[z * strideZ + y * strideY + x * strideX]
  }

  function radialToCartesian(vx: number, vy: number, vz: number): [number, number, number] {
    // Elevation interpolate
    const z0 = Math.max(0, Math.min(nz - 1, Math.floor(vz)))
    const z1 = Math.max(0, Math.min(nz - 1, Math.ceil(vz)))
    const fz = vz - Math.floor(vz)
    const elvLow = grid.elevationAngles[z0]
    const elvHigh = grid.elevationAngles[z1]
    const elvAngle = elvLow + ((elvHigh - elvLow) * fz)

    // Azimuth with interpolation across slots (wrap-aware)
    const y0 = Math.floor(vy)
    const y1 = (y0 + 1) % ny
    const fy = vy - y0
    const a0 = grid.azimuthSlots[Math.max(0, Math.min(ny - 1, y0))]
    const a1 = grid.azimuthSlots[Math.max(0, Math.min(ny - 1, y1))]
    // shortest angular difference (-180..180]
    let delta = a1 - a0
    delta = ((delta + 540) % 360) - 180
    let azimuth = a0 + delta * fy
    azimuth = ((azimuth % 360) + 360) % 360
    const angle = (90.0 - azimuth) * Math.PI / 180.0

    // Clamp vx to valid gate index range to avoid numeric spillover
    const vxClamped = Math.max(0, Math.min(nx - 1, vx))
    const gateDist = grid.startRange + (vxClamped * grid.gateInterval)
    const elvRad = elvAngle * Math.PI / 180.0
    const horiz = Math.cos(elvRad) * gateDist // ground distance
    // Map radar azimuth (0°=north, CW positive) to ENU meters (x=east, y=north).
    // Current observations indicate a 90° clockwise rotation; correct by rotating +90° CCW here.
    const X = -Math.sin(angle) * horiz
    const Y = Math.cos(angle) * horiz
    const Z = Math.sin(elvRad) * gateDist
    return [X, Y, Z]
  }

  const positions: number[] = []

  function len2(a: [number, number, number], b: [number, number, number]): number {
    const dx = a[0] - b[0]
    const dy = a[1] - b[1]
    const dz = a[2] - b[2]
    return dx*dx + dy*dy + dz*dz
  }
  function triOk(A: [number, number, number], B: [number, number, number], C: [number, number, number]): boolean {
    // Reject degenerate or numerically wild triangles
    const l1 = len2(A,B)
    const l2 = len2(B,C)
    const l3 = len2(C,A)
    const maxL2 = Math.max(l1, l2, l3)
    if (!isFinite(maxL2) || maxL2 <= 1e-4) return false
    // Dynamic size limit based on range and azimuth spacing
    const rA = Math.hypot(A[0], A[1])
    const rB = Math.hypot(B[0], B[1])
    const rC = Math.hypot(C[0], C[1])
    const rAvg = (rA + rB + rC) / 3
    const azResRad = Math.max(1e-6, (grid.azimuthResolution || 1) * Math.PI / 180)
    // Expected local cell span in meters (scaled generously)
    const expected = (rAvg * azResRad + grid.gateInterval) * 8
    const limit2 = expected * expected
    return maxL2 <= limit2
  }

  // Tetrahedra decomposition of a cube (indices into 0..7 cube corners)
  const tets: [number, number, number, number][] = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ]

  // Cube corner positions in voxel space helper
  function cubeCorner(x: number, y: number, z: number, i: number): [number, number, number] {
    switch (i) {
      case 0: return [x, y, z]
      case 1: return [x + 1, y, z]
      case 2: return [x + 1, y + 1, z]
      case 3: return [x, y + 1, z]
      case 4: return [x, y, z + 1]
      case 5: return [x + 1, y, z + 1]
      case 6: return [x + 1, y + 1, z + 1]
      case 7: return [x, y + 1, z + 1]
      default: return [x, y, z]
    }
  }

  // Iterate cubes
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // Corner scalar values
        const sv = [
          sample(x, y, z),
          sample(x + 1, y, z),
          sample(x + 1, y + 1, z),
          sample(x, y + 1, z),
          sample(x, y, z + 1),
          sample(x + 1, y, z + 1),
          sample(x + 1, y + 1, z + 1),
          sample(x, y + 1, z + 1),
        ]

        // Skip if any corner is no-data
        if (sv.some(v => v === -9999)) continue

        for (const tet of tets) {
          const ids = tet
          const tv = [sv[ids[0]], sv[ids[1]], sv[ids[2]], sv[ids[3]]]
          const tp = [
            cubeCorner(x, y, z, ids[0]),
            cubeCorner(x, y, z, ids[1]),
            cubeCorner(x, y, z, ids[2]),
            cubeCorner(x, y, z, ids[3]),
          ] as [number, number, number][]

          // Determine intersections on the 6 edges of tetra
          const edges: [number, number][] = [
            [0, 1], [1, 2], [2, 0],
            [0, 3], [1, 3], [2, 3],
          ]
          const pts: { p: [number, number, number]; e: [number, number] }[] = []
          for (const e of edges) {
            const a = e[0], b = e[1]
            const va = tv[a], vb = tv[b]
            const sideA = va < threshold
            const sideB = vb < threshold
            if (sideA !== sideB) {
              const denom = (vb - va)
              if (Math.abs(denom) < 1e-8) continue
              const tRaw = (threshold - va) / denom
              const t = Math.max(0, Math.min(1, tRaw))
              // Interpolated point along the edge; clamp to local cube bounds to avoid spill
              const x3 = Math.max(Math.min(tp[a][0], tp[b][0]), Math.min(Math.max(tp[a][0], tp[b][0]), lerp(tp[a][0], tp[b][0], t)))
              const y3 = Math.max(Math.min(tp[a][1], tp[b][1]), Math.min(Math.max(tp[a][1], tp[b][1]), lerp(tp[a][1], tp[b][1], t)))
              const z3 = Math.max(Math.min(tp[a][2], tp[b][2]), Math.min(Math.max(tp[a][2], tp[b][2]), lerp(tp[a][2], tp[b][2], t)))
              pts.push({ p: [x3, y3, z3], e })
            }
          }
          if (pts.length === 3) {
            const A = radialToCartesian(pts[0].p[0], pts[0].p[1], pts[0].p[2])
            const B = radialToCartesian(pts[1].p[0], pts[1].p[1], pts[1].p[2])
            const C = radialToCartesian(pts[2].p[0], pts[2].p[1], pts[2].p[2])
            if (triOk(A,B,C)) {
              positions.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2])
            }
          } else if (pts.length === 4) {
            // Order quad vertices by edge adjacency to avoid crossing diagonals
            const share = (a: [number, number], b: [number, number]) => (
              a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]
            )
            const order: number[] = [0]
            // pick second as any that shares a corner with first
            let used = new Set<number>(order)
            for (let i = 1; i < 4; i++) {
              let found = -1
              for (let j = 0; j < 4; j++) {
                if (used.has(j)) continue
                if (share(pts[order[order.length - 1]].e, pts[j].e)) { found = j; break }
              }
              if (found === -1) { // fallback to any remaining (shouldn't happen)
                for (let j = 0; j < 4; j++) if (!used.has(j)) { found = j; break }
              }
              order.push(found)
              used.add(found)
            }
            const P = order.map(i => pts[i])
            const Q = P.map(q => radialToCartesian(q.p[0], q.p[1], q.p[2]))
            if (triOk(Q[0],Q[1],Q[2])) {
              positions.push(
                Q[0][0], Q[0][1], Q[0][2], Q[1][0], Q[1][1], Q[1][2], Q[2][0], Q[2][1], Q[2][2]
              )
            }
            if (triOk(Q[0],Q[2],Q[3])) {
              positions.push(
                Q[0][0], Q[0][1], Q[0][2], Q[2][0], Q[2][1], Q[2][2], Q[3][0], Q[3][1], Q[3][2]
              )
            }
          }
        }
      }
    }
  }

  const indices = new Uint32Array(positions.length / 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return { positions: new Float32Array(positions), indices }
}
