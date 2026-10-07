/*
  The one texture the scene uses, drawn in code at start-up so nothing is
  downloaded: tileable fractal noise, from which the clouds and the mist
  are both shaped. A seeded random keeps it the same on every visit.
*/

import { DataTexture, LinearFilter, RedFormat, RepeatWrapping } from '../../vendor/three.min.js';

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise that repeats every "period" units in x and y.
function latticeNoise(random, period) {
  const grid = Float32Array.from({ length: period * period }, random);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
    const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = grid[y0 * period + x0];
    const b = grid[y0 * period + x1];
    const c = grid[y1 * period + x0];
    const d = grid[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Fractal noise over [0, 1) x [0, 1) that tiles: each octave repeats a
// whole number of times across the square.
function fractalNoise(random, periods, weights) {
  const octaves = periods.map((period) => latticeNoise(random, period));
  const total = weights.reduce((sum, w) => sum + w, 0);
  return (u, v) => {
    let n = 0;
    for (let i = 0; i < octaves.length; i++) n += octaves[i](u * periods[i], v * periods[i]) * weights[i];
    return n / total;
  };
}

// One channel of tileable noise, stretched to use the full range.
function tileableNoise(random) {
  const size = 256;
  const noise = fractalNoise(random, [3, 6, 12, 24, 48], [0.45, 0.25, 0.15, 0.1, 0.05]);
  const values = new Float32Array(size * size);
  let low = Infinity;
  let high = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x / size, y / size);
      values[y * size + x] = n;
      low = Math.min(low, n);
      high = Math.max(high, n);
    }
  }
  const data = Uint8Array.from(values, (n) => Math.round(((n - low) / (high - low)) * 255));
  const texture = new DataTexture(data, size, size, RedFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createTextures() {
  const random = seededRandom(20260926);
  const noise = tileableNoise(random);
  return { noise, dispose: () => noise.dispose() };
}
