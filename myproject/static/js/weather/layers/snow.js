/*
  Snow: flakes of many sizes drifting down at different speeds, swaying as
  they fall and carried sideways by the wind. Close flakes are large, soft
  and faint, like snow just out of focus; far ones are fine points. Flakes
  near the pointer ease out of its way.

  Like rain, "snow" (0-1) reveals flakes by a fixed random threshold, and
  all movement is worked out in the shader from accumulated fall and drift.
*/

import { Points, Vector3 } from '../../vendor/three.min.js';
import { COMMON_FRAGMENT, COMMON_VERTEX, HIDDEN } from '../three/glsl.js';
import { veilMaterial } from '../three/materials.js';
import { pointCloud } from '../three/particles.js';
import { seededRandom } from '../three/textures.js';

const FALL_SPEED = 1.2;  // world units per second

const vertexShader = /* glsl */ `
${COMMON_VERTEX}
attribute vec4 aFlake;   // x: size (0-1), y: speed, z: sway rate, w: sway phase
attribute float aReveal;
uniform float uFall;
uniform float uDrift;
uniform float uIntensity;
uniform float uOpacity;
varying float vAlpha;
varying float vSoft;

void main() {
  float reveal = 1.0 - smoothstep(uIntensity - 0.05, uIntensity, aReveal);
  if (reveal <= 0.0) { gl_Position = ${HIDDEN}; return; }

  float dist = mix(2.5, 34.0, position.z);
  float z = uCamZ - dist;
  vec2 extent = viewExtent(z) * vec2(1.15, 1.1);
  vec2 span = extent * 2.0;
  float speed = mix(0.6, 1.35, aFlake.y);
  float y = extent.y - mod(position.y * span.y + uFall * speed, span.y);
  float x = mod(position.x * span.x + uDrift * speed + extent.x, span.x) - extent.x;
  x += sin(uTime * aFlake.z + aFlake.w) * mix(0.12, 0.35, aFlake.x);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(x, y, z, 1.0);
  gl_Position = avoidPointer(clip, 0.045 * (1.0 - position.z));

  float size = mix(0.022, 0.07, aFlake.x * aFlake.x);
  gl_PointSize = clamp(size / pixelSize(dist), 1.2 * uPixelRatio, 34.0 * uPixelRatio);
  vSoft = 1.0 - smoothstep(3.0, 9.0, dist);
  vAlpha = uOpacity * reveal * mix(1.0, 0.45, position.z) * mix(1.0, 0.45, vSoft);
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
uniform vec3 uColor;
varying float vAlpha;
varying float vSoft;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(mix(0.45, 0.0, vSoft), 1.0, d)) * vAlpha;
  gl_FragColor = vec4(uColor + uFlash * 0.3, a * readable(0.5) * scrolled(0.4));
}
`;

export class Snow {
  constructor({ scene, shared, capability }) {
    const random = seededRandom(17);
    this.count = capability.snow;
    this.fall = 0;
    this.drift = 0;
    this.uniforms = {
      ...shared,
      uFall: { value: 0 },
      uDrift: { value: 0 },
      uIntensity: { value: 0 },
      uOpacity: { value: 0.85 },
      uColor: { value: new Vector3(0.96, 0.97, 1) },
    };
    this.geometry = pointCloud(this.count, () => [random(), random(), random() ** 0.7], [
      ['aFlake', 4, () => [random(), random(), 0.4 + random() * 0.7, random() * Math.PI * 2]],
      ['aReveal', 1, () => [random()]],
    ]);
    this.points = new Points(this.geometry, veilMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms }));
    this.points.renderOrder = 47;
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(p, frame) {
    const amount = frame.reducedMotion ? p.snow * 0.6 : p.snow;
    this.points.visible = amount > 0.003;
    if (!this.points.visible) return;
    this.fall = (this.fall + FALL_SPEED * frame.dt) % 10000;
    // Snow is light, so the wind pushes it further than rain.
    this.drift = (this.drift + FALL_SPEED * p.wind * 1.8 * frame.dt) % 10000;
    this.uniforms.uFall.value = this.fall;
    this.uniforms.uDrift.value = this.drift;
    this.uniforms.uIntensity.value = amount;
  }

  setDensity(share) {
    this.geometry.setDrawRange(0, Math.round(this.count * share));
  }

  dispose() {
    this.geometry.dispose();
    this.points.material.dispose();
  }
}
