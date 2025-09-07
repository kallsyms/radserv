import React, { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MapLibreMap, CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl'
import { fetchL2Radial, fetchL2Meta } from '../api/radar'
import type { RadialSet } from '../types'
import { buildVolumeGrid, type VolumeGrid, GATE_EMPTY_VALUE } from './grid'

type Props = {
  site: string
  file: string
  center: { lat: number; lon: number } | null
  viewCenter?: { lat: number; lon: number } | null
  viewZoom?: number | null
  showLabels: boolean
  showRoads: boolean
  onViewChange?: (center: { lat: number; lon: number }, zoom: number) => void
  onLoading: (loading: boolean) => void
}

const ESRI_IMG = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ROADS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

// Simple 4x4 matrix helpers (column-major)
function mat4Identity(): Float32Array {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}
function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] = a[i * 4 + 0] * b[0 * 4 + j] + a[i * 4 + 1] * b[1 * 4 + j] + a[i * 4 + 2] * b[2 * 4 + j] + a[i * 4 + 3] * b[3 * 4 + j]
    }
  }
  return out
}
function mat4Translate(m: Float32Array, x: number, y: number, z: number): Float32Array {
  const t = mat4Identity()
  t[12] = x; t[13] = y; t[14] = z
  return mat4Multiply(m, t)
}
function mat4Scale(m: Float32Array, x: number, y: number, z: number): Float32Array {
  const s = mat4Identity()
  s[0] = x; s[5] = y; s[10] = z
  return mat4Multiply(m, s)
}

type VolumeTexture2D = { tex: WebGLTexture; w: number; h: number; d: number; radiusMeters: number; innerRadiusMeters: number; heightMeters: number; baseAzDeg: number }

function resamplePolarToCartesian(grid: VolumeGrid, maxDims = { x: 128, y: 128, z: 128 }): { data2D: Uint8Array; w: number; h: number; d: number; radiusMeters: number; innerRadiusMeters: number; heightMeters: number; baseAzDeg: number } {
  const [ng, nr, ne] = grid.dims
  // Target dims (cap to max and keep square XY)
  const w = Math.min(maxDims.x, ng)
  const h = Math.min(maxDims.y, nr)
  const d = maxDims.z // Use full Z resolution, not limited by number of elevations

  const data = new Uint8Array(w * h * d)
  const start = grid.startRange
  const gi = grid.gateInterval
  const maxEl = grid.elevationAngles[grid.elevationAngles.length - 1] || 0
  const maxRange = start + gi * (ng - 1)
  const radiusMeters = maxRange
  const innerRadiusMeters = start
  // Calculate a more reasonable height based on a typical range (e.g., 100km)
  const typicalRange = Math.min(100000, maxRange) // 100km or max range, whichever is smaller
  const heightMeters = Math.max(20000, Math.sin(maxEl * Math.PI / 180) * typicalRange)
  
  // Debug elevation info
  console.log('Volumetric grid info:', {
    elevations: grid.elevationAngles,
    maxEl,
    heightMeters,
    dimensions: [w, h, d],
    maxRange
  })

  // Transfer function window (dBZ range)
  const dbzMin = -10
  const dbzMax = 70
  function toU8(v: number): number {
    if (v === GATE_EMPTY_VALUE || !isFinite(v)) return 0
    const t = Math.max(0, Math.min(1, (v - dbzMin) / (dbzMax - dbzMin)))
    return Math.round(t * 255)
  }

  // Precompute azimuth base and resolution
  const azRes = grid.azimuthResolution || 1
  const baseAz = grid.azimuthSlots[0] || 0
  const nRadials = nr

  // Sampling helpers
  function at(g: number, r: number, e: number): number {
    const nx = ng, ny = nr, nz = ne
    if (g < 0 || g >= nx || r < 0 || r >= ny || e < 0 || e >= nz) return GATE_EMPTY_VALUE
    return grid.data[e * (nx * ny) + r * nx + g]
  }

  // New approach: instead of mapping height slices to elevations,
  // directly populate based on each elevation's actual height at each range
  data.fill(0) // start with empty volume
  
  const populatedSlices = new Set<number>()
  const sliceStats = new Map<number, { count: number, maxVal: number }>()
  
  // For each elevation angle, calculate its contribution to the volume
  for (let elIdx = 0; elIdx < grid.elevationAngles.length; elIdx++) {
    const elAngle = grid.elevationAngles[elIdx]
    const elRad = elAngle * Math.PI / 180
    // Processing elevation ${elIdx}: ${elAngle.toFixed(2)}°
    
    for (let ky = 0; ky < h; ky++) {
      // map ky to radar azimuth degrees (0=N, clockwise positive)
      const azDeg = (ky / h) * 360
      // Match 2D rendering approach: subtract 90° to align with expected coordinate system
      const adjustedAz = azDeg - 90
      const azRad = adjustedAz * Math.PI / 180
      // Use sine and cosine directly on the adjusted angle
      const cosAngle = Math.cos(azRad)
      const sinAngle = Math.sin(azRad)
      
      for (let kx = 0; kx < w; kx++) {
        // map kx to radius [start, maxRange]
        const rMeters = start + (kx / Math.max(1, w - 1)) * (maxRange - start)
        const x = cosAngle * rMeters
        const y = sinAngle * rMeters
        
        // Skip inside first valid gate to avoid artificial column at site
        if (rMeters < start + 0.75 * gi) continue
        
        // Calculate the actual height of this elevation at this range
        const actualHeight = Math.sin(elRad) * rMeters
        
        // Find which height slice this corresponds to
        const kz = Math.round((actualHeight / heightMeters) * (d - 1))
        if (kz < 0 || kz >= d) continue
        
        // Debug height mapping removed
        
        // Map (x,y) -> (gate, azIdx) with interpolation
        const r = Math.sqrt(x * x + y * y)
        const gIdxFloat = (r - start) / gi
        const gIdx0 = Math.floor(gIdxFloat)
        const gIdx1 = Math.ceil(gIdxFloat)
        const gFrac = gIdxFloat - gIdx0
        
        if (gIdx0 < 0 || gIdx1 >= ng) continue
        
        // Inverse mapping: convert back to NEXRAD azimuth with interpolation
        let adjustedAzBack = Math.atan2(y, x) * 180 / Math.PI
        let az = adjustedAzBack + 90.0
        // normalize to [0,360)
        az = ((az % 360) + 360) % 360
        const jFloat = (az - baseAz) / azRes
        const j0 = Math.floor(jFloat)
        const j1 = Math.ceil(jFloat)
        const jFrac = jFloat - j0
        
        // wrap both indices
        const j0Wrapped = ((j0 % nRadials) + nRadials) % nRadials
        const j1Wrapped = ((j1 % nRadials) + nRadials) % nRadials

        // Bilinear interpolation: range x azimuth
        const v00 = at(gIdx0, j0Wrapped, elIdx)
        const v01 = at(gIdx0, j1Wrapped, elIdx) 
        const v10 = at(gIdx1, j0Wrapped, elIdx)
        const v11 = at(gIdx1, j1Wrapped, elIdx)
        
        // Interpolate in range direction first
        let vBottom = v00, vTop = v10
        if (v00 !== GATE_EMPTY_VALUE && v10 !== GATE_EMPTY_VALUE) {
          vBottom = v00 + (v10 - v00) * gFrac
        } else if (v00 !== GATE_EMPTY_VALUE) {
          vBottom = v00
        } else if (v10 !== GATE_EMPTY_VALUE) {
          vBottom = v10
        } else {
          vBottom = GATE_EMPTY_VALUE
        }
        
        if (v01 !== GATE_EMPTY_VALUE && v11 !== GATE_EMPTY_VALUE) {
          vTop = v01 + (v11 - v01) * gFrac
        } else if (v01 !== GATE_EMPTY_VALUE) {
          vTop = v01
        } else if (v11 !== GATE_EMPTY_VALUE) {
          vTop = v11
        } else {
          vTop = GATE_EMPTY_VALUE
        }
        
        // Then interpolate in azimuth direction
        let v = vBottom // fallback
        if (vBottom !== GATE_EMPTY_VALUE && vTop !== GATE_EMPTY_VALUE) {
          v = vBottom + (vTop - vBottom) * jFrac
        } else if (vBottom !== GATE_EMPTY_VALUE) {
          v = vBottom
        } else if (vTop !== GATE_EMPTY_VALUE) {
          v = vTop
        } else {
          v = GATE_EMPTY_VALUE
        }
        if (v !== GATE_EMPTY_VALUE && isFinite(v)) {
          data[kz * (w * h) + ky * w + kx] = toU8(v)
          populatedSlices.add(kz)
          
          const current = sliceStats.get(kz) || { count: 0, maxVal: 0 }
          current.count++
          current.maxVal = Math.max(current.maxVal, v)
          sliceStats.set(kz, current)
        }
      }
    }
  }

  // Debug slice population
  console.log('Populated slices:', Array.from(populatedSlices).sort((a, b) => a - b))
  console.log('Slice statistics:', Array.from(sliceStats.entries())
    .sort(([a], [b]) => a - b)
    .map(([slice, stats]) => ({ slice, ...stats })))

  // Pack slices into a single 2D texture of size w x (h*d)
  const data2D = new Uint8Array(w * h * d)
  for (let z = 0; z < d; z++) {
    const srcOff = z * (w * h)
    const dstOff = z * (w * h)
    data2D.set(data.subarray(srcOff, srcOff + w * h), dstOff)
  }
  return { data2D, w, h, d, radiusMeters, innerRadiusMeters, heightMeters, baseAzDeg: baseAz }
}

// Build a MapLibre custom layer that renders a 3D texture as instanced slices
export function makeVolumeLayer(id: string, getGrid: () => ReturnType<typeof buildVolumeGrid> | null, originLonLat: [number, number], initialOpacity: number = 0.7): CustomLayerInterface {
  // WebGL1-friendly implementation using a 2D texture atlas and per-slice draws
  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let vbo: WebGLBuffer | null = null
  let volume: VolumeTexture2D | null = null

  let aPosLoc = 0
  let uMatrixLoc: WebGLUniformLocation | null = null
  let uRadiusLoc: WebGLUniformLocation | null = null
  let uHeightLoc: WebGLUniformLocation | null = null
  let uSliceLoc: WebGLUniformLocation | null = null
  let uDepthLoc: WebGLUniformLocation | null = null
  let uOriginLoc: WebGLUniformLocation | null = null
  let uM2MLoc: WebGLUniformLocation | null = null
  let uSamplerLoc: WebGLUniformLocation | null = null
  let uOpacityLoc: WebGLUniformLocation | null = null
  let uDebugLoc: WebGLUniformLocation | null = null
  let uDbgColorLoc: WebGLUniformLocation | null = null
  let uBaseAzLoc: WebGLUniformLocation | null = null
  let uInnerRadiusLoc: WebGLUniformLocation | null = null
  // Dynamic UI-controlled state
  let overlayOpacity = Math.max(0, Math.min(1, initialOpacity))

  const vsSrc = `
  attribute vec2 a_pos; // unit quad in XY, scaled by radius (meters)
  uniform mat4 u_matrix; // map proj*view (mercator world units)
  uniform float u_radius; // meters
  uniform float u_height; // meters
  uniform float u_slice; // 0..(d-1)
  uniform float u_depth; // d
  uniform vec3 u_origin; // mercator world units
  uniform float u_m2m;   // meters -> mercator units
  varying vec2 v_xyMeters; // local XY in meters relative to radar
  varying float v_layer;
  void main() {
    float zMeters = (u_slice / max(u_depth - 1.0, 1.0)) * u_height;
    vec2 xyMeters = a_pos * u_radius;
    vec3 posMerc = vec3(xyMeters * u_m2m + u_origin.xy, zMeters * u_m2m + u_origin.z);
    v_xyMeters = xyMeters;
    v_layer = u_slice;
    gl_Position = u_matrix * vec4(posMerc, 1.0);
  }
  `
  const fsSrc = `
  precision highp float;
  varying vec2 v_xyMeters;
  varying float v_layer;
  uniform sampler2D u_volume2D; // packed as w x (h*d)
  uniform float u_depth; // d
  uniform float u_opacity;
  uniform float u_debug; // >0: solid color debug
  uniform vec3 u_dbgColor;
  uniform float u_radius; // meters (same as VS)
  uniform float u_baseAzDeg; // atlas zero azimuth in degrees
  uniform float u_innerRadius; // meters; startRange of radar

  vec3 tf(float t) {
    // NOAA reflectivity color map with smooth transitions but preserved peak values
    // t is normalized [0,1] representing dBZ range [-10, 70]
    float dbz = -10.0 + t * 80.0;
    
    if (dbz < 5.0) {
      return vec3(0.0, 0.0, 0.0);
    }
    
    // Use smoother transitions but don't dilute the core colors
    if (dbz >= 65.0) {
      if (dbz >= 70.0) {
        return vec3(0.569, 0.380, 0.769); // purple for 70+
      }
      float frac = smoothstep(65.0, 70.0, dbz);
      return mix(vec3(0.933, 0.204, 0.980), vec3(0.569, 0.380, 0.769), frac); // magenta to purple
    } else if (dbz >= 60.0) {
      float frac = smoothstep(60.0, 65.0, dbz);
      return mix(vec3(0.663, 0.031, 0.075), vec3(0.933, 0.204, 0.980), frac); // darker red to magenta
    } else if (dbz >= 55.0) {
      float frac = smoothstep(55.0, 60.0, dbz);
      return mix(vec3(0.796, 0.020, 0.086), vec3(0.663, 0.031, 0.075), frac); // dark red to darker red
    } else if (dbz >= 50.0) {
      float frac = smoothstep(50.0, 55.0, dbz);
      return mix(vec3(0.973, 0.039, 0.149), vec3(0.796, 0.020, 0.086), frac); // red to dark red
    } else if (dbz >= 45.0) {
      float frac = smoothstep(45.0, 52.0, dbz); // wider transition to preserve reds
      return mix(vec3(0.965, 0.584, 0.180), vec3(0.973, 0.039, 0.149), frac); // light red to red
    } else if (dbz >= 40.0) {
      float frac = smoothstep(40.0, 47.0, dbz); // wider transition
      return mix(vec3(0.922, 0.706, 0.200), vec3(0.965, 0.584, 0.180), frac); // orange to light red
    } else if (dbz >= 35.0) {
      float frac = smoothstep(35.0, 42.0, dbz); // wider transition
      return mix(vec3(0.996, 0.961, 0.263), vec3(0.922, 0.706, 0.200), frac); // yellow to orange
    } else if (dbz >= 30.0) {
      float frac = smoothstep(30.0, 37.0, dbz); // wider transition
      return mix(vec3(0.153, 0.549, 0.118), vec3(0.996, 0.961, 0.263), frac); // dark green to yellow
    } else if (dbz >= 25.0) {
      float frac = smoothstep(25.0, 32.0, dbz);
      return mix(vec3(0.212, 0.761, 0.180), vec3(0.153, 0.549, 0.118), frac); // green to dark green
    } else if (dbz >= 20.0) {
      float frac = smoothstep(20.0, 27.0, dbz);
      return mix(vec3(0.286, 0.984, 0.243), vec3(0.212, 0.761, 0.180), frac); // light green to green
    } else if (dbz >= 15.0) {
      float frac = smoothstep(15.0, 22.0, dbz);
      return mix(vec3(0.000, 0.188, 0.929), vec3(0.286, 0.984, 0.243), frac); // blue to light green
    } else if (dbz >= 10.0) {
      float frac = smoothstep(10.0, 17.0, dbz);
      return mix(vec3(0.149, 0.643, 0.980), vec3(0.000, 0.188, 0.929), frac); // light blue to blue
    } else {
      float frac = smoothstep(5.0, 12.0, dbz);
      return mix(vec3(0.251, 0.910, 0.890), vec3(0.149, 0.643, 0.980), frac); // cyan to light blue
    }
  }

  void main() {
    if (u_debug > 0.5) {
      gl_FragColor = vec4(u_dbgColor, 0.6);
      return;
    }
    // Convert local XY meters to polar coords
    float rMeters = length(v_xyMeters);
    if (rMeters > u_radius || rMeters < u_innerRadius) discard;
    float rN = clamp((rMeters - u_innerRadius) / max(u_radius - u_innerRadius, 1.0), 0.0, 1.0);
    // Compute azimuth (0° = North, clockwise positive) for NEXRAD convention
    // Match the coordinate system: azimuth = atan2(Y, X) + 90
    float adjustedAz = degrees(atan(v_xyMeters.y, v_xyMeters.x));
    float azDeg = adjustedAz + 90.0;
    if (azDeg < 0.0) azDeg += 360.0;
    // Align with atlas azimuth zero
    // atlas rows are packed from 0..360 with 0 at north; no additional offset
    float azN = azDeg / 360.0; // 0..1
    // Sample atlas: y spans slices stacked vertically: (layer + azN) / depth
    float v = (v_layer + azN) / max(u_depth, 1.0);
    float s = texture2D(u_volume2D, vec2(rN, v)).r;
    // Better alpha calculation to prevent overdraw washout
    float a = pow(clamp(s, 0.0, 1.0), 1.8) * u_opacity * 0.3; // Balanced alpha
    if (a < 0.01) discard;
    vec3 c = tf(s);
    gl_FragColor = vec4(c, a);
  }
  `

  function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'shader error'
      console.error(log)
      gl.deleteShader(sh)
      throw new Error(log)
    }
    return sh
  }
  function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'link error'
      console.error(log)
      gl.deleteProgram(prog)
      throw new Error(log)
    }
    return prog
  }

  function ensureTexture(): void {
    if (!gl) return
    const grid = getGrid()
    if (!grid) return
    // Resample and upload as a 2D texture atlas (w x (h*d))
    const res = resamplePolarToCartesian(grid)
    const tex = gl!.createTexture()!
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
    gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    // LUMINANCE for single channel in WebGL1
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.LUMINANCE, res.w, res.h * res.d, 0, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, res.data2D)
    volume = { tex, w: res.w, h: res.h, d: res.d, radiusMeters: res.radiusMeters, innerRadiusMeters: res.innerRadiusMeters, heightMeters: res.heightMeters, baseAzDeg: res.baseAzDeg }
    
  }

  function ensureProgramAndBuffers(): void {
    if (!gl) return
    if (!program) {
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
        const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
        program = link(gl, vs, fs)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
      } catch (e) {
        program = null
        return
      }
      aPosLoc = gl.getAttribLocation(program!, 'a_pos')
      uMatrixLoc = gl.getUniformLocation(program!, 'u_matrix')
      uRadiusLoc = gl.getUniformLocation(program!, 'u_radius')
      uHeightLoc = gl.getUniformLocation(program!, 'u_height')
      uSliceLoc = gl.getUniformLocation(program!, 'u_slice')
      uDepthLoc = gl.getUniformLocation(program!, 'u_depth')
      uSamplerLoc = gl.getUniformLocation(program!, 'u_volume2D')
      uOpacityLoc = gl.getUniformLocation(program!, 'u_opacity')
      uOriginLoc = gl.getUniformLocation(program!, 'u_origin')
      uM2MLoc = gl.getUniformLocation(program!, 'u_m2m')
      uDebugLoc = gl.getUniformLocation(program!, 'u_debug')
      uDbgColorLoc = gl.getUniformLocation(program!, 'u_dbgColor')
      uBaseAzLoc = gl.getUniformLocation(program!, 'u_baseAzDeg')
      uInnerRadiusLoc = gl.getUniformLocation(program!, 'u_innerRadius')
    }
    if (!vbo) {
      vbo = gl.createBuffer()!
      const quad = new Float32Array([
        -1, -1,
         1, -1,
         1,  1,
        -1, -1,
         1,  1,
        -1,  1,
      ])
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
    }
  }

  // Keep a cached mercator transform for the origin and meter conversion
  const merc = MercatorCoordinate.fromLngLat({ lon: originLonLat[0], lat: originLonLat[1] }, 0)
  // Conversion from meters to Mercator world units at this lat using delta z for 1m altitude
  const _m1 = MercatorCoordinate.fromLngLat({ lon: originLonLat[0], lat: originLonLat[1] }, 1)
  const metersToMerc = ((_m1.z || 0) - (merc.z || 0)) || 1e-6

  return {
    id,
    type: 'custom',
    renderingMode: '2d',
    // Custom helper for external updates
    setOpacity(v: number) { overlayOpacity = Math.max(0, Math.min(1, v)); },
    onAdd(map: MapLibreMap, _gl: WebGLRenderingContext) {
      gl = _gl
      try {
        ensureProgramAndBuffers()
        ensureTexture()
        // Avoid mutating global GL state here; MapLibre manages state for 2D layers.
      } catch (e) {
        // swallow
      }
    },
    onRemove(map: MapLibreMap, _gl: WebGLRenderingContext) {
      if (!gl) return
      if (volume && volume.tex) gl.deleteTexture(volume.tex)
      if (vbo) gl.deleteBuffer(vbo)
      if (program) gl.deleteProgram(program)
      program = null; vbo = null; volume = null
    },
    // MapLibre v2 render signature: (gl, matrix)
    render(glParam: WebGLRenderingContext, matrix: number[]) {
      gl = glParam
      if (!program) { ensureProgramAndBuffers(); if (!program) return }

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.enableVertexAttribArray(aPosLoc)
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0)
      gl.uniformMatrix4fv(uMatrixLoc, false, new Float32Array(matrix))
      gl.uniform3f(uOriginLoc!, merc.x, merc.y, merc.z || 0)
      gl.uniform1f(uM2MLoc!, metersToMerc)

      // Debug path if volume not ready yet: draw a solid quad at origin
      if (!volume) {
        gl.uniform1f(uRadiusLoc, 10000.0)
        gl.uniform1f(uHeightLoc, 0.0)
        gl.uniform1f(uDepthLoc, 1.0)
        gl.uniform1f(uSliceLoc, 0.0)
        gl.uniform1f(uOpacityLoc, 1.0)
        gl.uniform1f(uDebugLoc, 1.0)
        gl.uniform3f(uDbgColorLoc, 0.0, 1.0, 0.2)
        gl.uniform1f(uBaseAzLoc!, 0.0)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        return
      }

      // Enable blending with additive mode to prevent white washout
      const hadBlend = gl.isEnabled(gl.BLEND)
      if (!hadBlend) gl.enable(gl.BLEND)
      // Use additive blending for better volumetric appearance
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

      // Multi-slice sampling front-to-back
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, volume.tex)
      gl.uniform1i(uSamplerLoc, 0)
      gl.uniform1f(uRadiusLoc, volume.radiusMeters)
      gl.uniform1f(uInnerRadiusLoc!, volume.innerRadiusMeters)
      gl.uniform1f(uHeightLoc, volume.heightMeters)
      gl.uniform1f(uDepthLoc, volume.d)
      gl.uniform1f(uOpacityLoc, overlayOpacity)
      gl.uniform1f(uDebugLoc, 0.0)
      gl.uniform1f(uBaseAzLoc!, volume.baseAzDeg)
      gl.uniform3f(uDbgColorLoc, 0.0, 0.0, 0.0)
      for (let i = 0; i < volume.d; i++) {
        gl.uniform1f(uSliceLoc, i)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      }

      if (!hadBlend) gl.disable(gl.BLEND)
    }
  } as any
}

export default function VolumeView3D({ site, file, center, viewCenter = null, viewZoom = null, showLabels, showRoads, onLoading, onViewChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [gridState, setGridState] = useState<ReturnType<typeof buildVolumeGrid> | null>(null)
  const layerIdRef = useRef<string>('volume-layer')
  const firstLoadRef = useRef(true)

  // init maplibre (run once)
  useEffect(() => {
    if (!containerRef.current) return
    const style: any = {
      version: 8,
      sources: {
        esri: { type: 'raster', tiles: [ESRI_IMG], tileSize: 256, attribution: 'Imagery © Esri' },
        labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, attribution: 'Labels © Esri' },
        roads: { type: 'raster', tiles: [ESRI_ROADS], tileSize: 256, attribution: 'Roads © Esri' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1221' } },
        { id: 'esri', type: 'raster', source: 'esri' },
        { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: showLabels ? 'visible' : 'none' } },
        { id: 'roads', type: 'raster', source: 'roads', layout: { visibility: showRoads ? 'visible' : 'none' } },
      ],
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: (viewCenter || center) ? [
        (viewCenter || center)!.lon,
        (viewCenter || center)!.lat,
      ] : [-98, 39],
      zoom: viewZoom ?? 5,
      pitch: 60,
      maxZoom: 11,
      minZoom: 3,
      attributionControl: true,
    })
    mapRef.current = map
    
    map.on('error', (e: any) => { try { console.error('MapLibre error', e && e.error || e) } catch {} })
    // propagate view changes to parent
    map.on('moveend', () => {
      if (!onViewChange) return
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng }, map.getZoom())
    })
    map.on('zoomend', () => {
      if (!onViewChange) return
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng }, map.getZoom())
    })
    return () => {
      if (mapRef.current) mapRef.current.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // toggle overlays visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!site || !file) {
      return
    }
    if (map.getLayer('labels')) map.setLayoutProperty('labels', 'visibility', showLabels ? 'visible' : 'none')
    if (map.getLayer('roads')) map.setLayoutProperty('roads', 'visibility', showRoads ? 'visible' : 'none')
  }, [showLabels, showRoads])

  // Fetch all elevations and assemble grid
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    onLoading(true)
    ;(async () => {
      try {
        // Discover elevations with data from metadata
        const meta = await fetchL2Meta(site, file)
        const elevations = (meta?.ElevationChunks || [])
          .map((arr: number[], idx: number) => (arr && arr.length > 0) ? idx + 1 : 0)
          .filter((e: number) => e > 0)
        // Fetch radial sets concurrently (reflectivity only for volume)
        const results: RadialSet[] = await Promise.all(
          elevations.map((elv: number) => fetchL2Radial(site, file, 'ref', elv))
        )
        if (cancelled) return
        const grid = buildVolumeGrid(results)
        setGridState(grid)
        // Attach or update custom layer
        const id = layerIdRef.current
        if (map.getLayer(id)) map.removeLayer(id)
        // Determine origin for layer: prefer provided center; else first radial lon/lat; else map center
        let originLon = center?.lon
        let originLat = center?.lat
        if (originLon === undefined || originLat === undefined) {
          const cFromData = (results && results.length > 0) ? { lon: results[0].Lon, lat: results[0].Lat } : null
          originLon = originLon ?? cFromData?.lon ?? map.getCenter().lng
          originLat = originLat ?? cFromData?.lat ?? map.getCenter().lat
        }
        const custom = makeVolumeLayer(id, () => gridState || grid, [originLon as number, originLat as number])
        map.addLayer(custom)
        
        // If parent hasn't provided a persisted view, optionally fit to radar center once
        if (firstLoadRef.current && !viewCenter && center) {
          firstLoadRef.current = false
          map.easeTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), 6), duration: 400 })
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (!cancelled) onLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [site, file])

  return <div ref={containerRef} className="absolute inset-0" />
}
