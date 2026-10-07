/*
  Rain: thousands of streaks, each a quad stretched along its fall and
  slanted by the wind, brightest at the head. Drops are spread through
  depth: close ones are long, soft and faint, distant ones short and hazy,
  and none is ever drawn thinner than a pixel, so the far rain doesn't
  shimmer. Drops light up with lightning.

  "rain" (0-1) is the share of drops falling: each drop has a fixed random
  threshold, so rain starts with a few drops and thickens, with nothing
  rebuilt. Drops above the threshold are moved outside the view and cost
  almost nothing.

  Small rings flick up along the bottom edge as drops land. They live in
  the shader too: each splash restarts on its own cycle at a new random
  place.
*/

import { Mesh, Vector3 } from '../../vendor/three.min.js';
import { COMMON_FRAGMENT, COMMON_VERTEX, HIDDEN } from '../three/glsl.js';
import { lightMaterial } from '../three/materials.js';
import { instancedQuads } from '../three/particles.js';
import { seededRandom } from '../three/textures.js';

const FALL_SPEED = 13;  // world units per second

const rainVertex = /* glsl */ `
${COMMON_VERTEX}
attribute vec4 aDrop;   // x, y: place across the view (0-1), z: depth (0 near, 1 far), w: reveal threshold
attribute vec2 aVary;   // speed and length factors
uniform float uFall;
uniform float uDrift;
uniform float uWind;
uniform float uIntensity;
uniform float uLength;
uniform float uWidth;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vQuad;

void main() {
  float reveal = 1.0 - smoothstep(uIntensity - 0.04, uIntensity, aDrop.w);
  if (reveal <= 0.0) { gl_Position = ${HIDDEN}; return; }

  float dist = mix(3.5, 36.0, aDrop.z);
  float z = uCamZ - dist;
  vec2 extent = viewExtent(z) * vec2(1.25, 1.15);
  vec2 span = extent * 2.0;
  float y = extent.y - mod(aDrop.y * span.y + uFall * aVary.x, span.y);
  float x = mod(aDrop.x * span.x + uDrift * aVary.x + extent.x, span.x) - extent.x;

  vec2 dir = normalize(vec2(uWind, -1.0));   // which way the drop travels
  vec2 across = vec2(-dir.y, dir.x);
  float width = max(uWidth, pixelSize(dist) * 1.1);
  vec2 p = vec2(x, y) - dir * uLength * aVary.y * position.y + across * width * position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, z, 1.0);

  float hazy = mix(1.0, 0.35, aDrop.z);
  float thin = mix(1.0, uWidth / width, 0.7);     // drops widened to a pixel get fainter
  float close = mix(0.35, 1.0, smoothstep(3.5, 7.0, dist));
  vAlpha = uOpacity * reveal * hazy * thin * close;
  vQuad = position.xy;
}
`;

const rainFragment = /* glsl */ `
${COMMON_FRAGMENT}
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vQuad;

void main() {
  float across = 1.0 - abs(vQuad.x) * 2.0;
  float along = 1.0 - vQuad.y;   // 1 at the head, 0 at the tail
  float a = vAlpha * smoothstep(0.0, 0.8, across) * along * along;
  gl_FragColor = vec4(uColor + uFlash * 0.6, a * readable(0.5) * scrolled(0.4));
}
`;

const splashVertex = /* glsl */ `
${COMMON_VERTEX}
attribute vec4 aSplash;   // x: seed, y: phase, z: cycle length (s), w: depth (0-1)
uniform float uIntensity;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vQuad;

float rand(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  if (aSplash.x > uIntensity) { gl_Position = ${HIDDEN}; return; }
  float cycle = uTime / aSplash.z + aSplash.y;
  float turn = floor(cycle);
  float t = fract(cycle);
  float z = mix(-6.0, 4.0, aSplash.w);
  vec2 extent = viewExtent(z);
  float x = (rand(turn + aSplash.x * 91.7) * 2.0 - 1.0) * extent.x;
  float y = -extent.y * (0.95 - rand(turn * 1.7 + aSplash.x * 37.3) * 0.08);
  float size = mix(0.03, 0.14, smoothstep(0.0, 0.3, t)) * mix(1.0, 0.6, aSplash.w);
  vec2 corner = (position.xy - vec2(0.0, 0.5)) * vec2(size, size * 0.35);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x + corner.x, y + corner.y, z, 1.0);
  vAlpha = uOpacity * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.04, 0.3, t));
  vQuad = position.xy - vec2(0.0, 0.5);
}
`;

const splashFragment = /* glsl */ `
${COMMON_FRAGMENT}
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vQuad;

void main() {
  float r = length(vQuad * 2.0);
  float ring = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(uColor, ring * vAlpha * readable(0.5) * scrolled(0.3));
}
`;

export class Rain {
  constructor({ scene, shared, capability }) {
    const random = seededRandom(3);
    this.count = capability.rain;
    this.fall = 0;
    this.drift = 0;
    const color = new Vector3(0.66, 0.77, 0.91);

    this.uniforms = {
      ...shared,
      uFall: { value: 0 },
      uDrift: { value: 0 },
      uWind: { value: 0 },
      uIntensity: { value: 0 },
      uLength: { value: 0.55 },
      uWidth: { value: 0.012 },
      uOpacity: { value: 0.4 },
      uColor: { value: color },
    };
    this.drops = new Mesh(
      instancedQuads(this.count, [
        // Depth leans towards the distance, where the frustum is widest.
        ['aDrop', 4, () => [random(), random(), random() ** 0.65, random()]],
        ['aVary', 2, () => [0.85 + random() * 0.3, 0.7 + random() * 0.6]],
      ]),
      lightMaterial({ vertexShader: rainVertex, fragmentShader: rainFragment, uniforms: this.uniforms }),
    );
    this.drops.renderOrder = 45;
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);

    this.splashes = null;
    if (capability.splashes) {
      this.splashUniforms = { ...shared, uIntensity: { value: 0 }, uOpacity: { value: 0.22 }, uColor: { value: color } };
      this.splashes = new Mesh(
        instancedQuads(capability.splashes, [
          ['aSplash', 4, () => [random(), random(), 0.45 + random() * 0.4, random()]],
        ]),
        lightMaterial({ vertexShader: splashVertex, fragmentShader: splashFragment, uniforms: this.splashUniforms }),
      );
      this.splashes.renderOrder = 46;
      this.splashes.frustumCulled = false;
      this.splashes.visible = false;
      scene.add(this.splashes);
    }
  }

  update(p, frame) {
    // Without motion, a still frame shows a lighter shower.
    const amount = frame.reducedMotion ? p.rain * 0.5 : p.rain;
    this.drops.visible = amount > 0.003;
    if (this.splashes) {
      this.splashes.visible = this.drops.visible && !frame.reducedMotion;
      this.splashUniforms.uIntensity.value = amount;
    }
    if (!this.drops.visible) return;

    const size = p.rainSize;
    const speed = FALL_SPEED * (0.7 + 0.3 * size);
    this.fall = (this.fall + speed * frame.dt) % 10000;
    this.drift = (this.drift + speed * p.wind * frame.dt) % 10000;

    const u = this.uniforms;
    u.uFall.value = this.fall;
    u.uDrift.value = this.drift;
    u.uWind.value = p.wind;
    u.uIntensity.value = amount;
    u.uLength.value = 0.55 * (0.45 + 0.55 * size);
    u.uWidth.value = 0.012 * (0.7 + 0.3 * size);
    u.uOpacity.value = 0.38 + p.storm * 0.12;
  }

  setDensity(share) {
    this.drops.geometry.instanceCount = Math.round(this.count * share);
  }

  dispose() {
    for (const mesh of [this.drops, this.splashes]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
