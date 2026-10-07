/*
  Motes: a few specks floating in the air near the camera. On clear days
  they are warm dust that glints now and then as it turns in the sun; in
  mist they are larger, greyer droplets. They rise slowly and ease away
  from the pointer.
*/

import { Points, Vector3 } from '../../vendor/three.min.js';
import { COMMON_FRAGMENT, COMMON_VERTEX, HIDDEN } from '../three/glsl.js';
import { lightMaterial } from '../three/materials.js';
import { pointCloud } from '../three/particles.js';
import { seededRandom } from '../three/textures.js';

const vertexShader = /* glsl */ `
${COMMON_VERTEX}
attribute vec4 aMote;   // x: size, y: drift rate, z: glint rate, w: phase
attribute float aReveal;
uniform float uIntensity;
uniform float uSize;
varying float vAlpha;

void main() {
  float reveal = 1.0 - smoothstep(uIntensity - 0.08, uIntensity, aReveal);
  if (reveal <= 0.0) { gl_Position = ${HIDDEN}; return; }

  float dist = mix(3.0, 22.0, position.z);
  float z = uCamZ - dist;
  vec2 extent = viewExtent(z) * 1.1;
  vec2 span = extent * 2.0;
  float t = uTime;
  float x = mod(position.x * span.x + t * 0.05 + extent.x, span.x) - extent.x
          + sin(t * 0.21 * (0.5 + aMote.y) + aMote.w) * 0.35;
  float y = mod(position.y * span.y + t * mix(0.03, 0.09, aMote.y) + extent.y, span.y) - extent.y
          + cos(t * 0.17 + aMote.w * 1.7) * 0.25;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(x, y, z, 1.0);
  gl_Position = avoidPointer(clip, 0.03);

  // Mostly faint, catching the light now and then as they turn.
  float glint = pow(0.5 + 0.5 * sin(t * mix(0.3, 0.9, aMote.z) + aMote.w * 6.2831), 12.0);
  vAlpha = reveal * (0.1 + 0.9 * glint) * mix(1.0, 0.45, position.z);
  gl_PointSize = mix(2.5, 6.0, aMote.x) * uSize * uPixelRatio * mix(1.3, 0.7, position.z);
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * (1.0 - d) * vAlpha * uOpacity;  // a soft out-of-focus dot
  gl_FragColor = vec4(uColor, a * readable(0.6) * scrolled(0.5));
}
`;

export class Motes {
  constructor({ scene, shared, capability }) {
    const random = seededRandom(29);
    this.count = capability.motes;
    this.uniforms = {
      ...shared,
      uIntensity: { value: 0 },
      uSize: { value: 1 },
      uOpacity: { value: 0.5 },
      uColor: { value: new Vector3() },
    };
    this.geometry = pointCloud(this.count, () => [random(), random(), random()], [
      ['aMote', 4, () => [random(), random(), random(), random() * Math.PI * 2]],
      ['aReveal', 1, () => [random()]],
    ]);
    this.points = new Points(this.geometry, lightMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms }));
    this.points.renderOrder = 65;
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(p) {
    this.points.visible = p.motes > 0.005;
    this.uniforms.uIntensity.value = p.motes;
    this.uniforms.uSize.value = 1 + p.fog * 0.8;
    this.uniforms.uColor.value.fromArray(p.moteColor);
  }

  setDensity(share) {
    this.geometry.setDrawRange(0, Math.round(this.count * share));
  }

  dispose() {
    this.geometry.dispose();
    this.points.material.dispose();
  }
}
