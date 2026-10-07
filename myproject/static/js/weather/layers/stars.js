/*
  Stars for clear nights and the welcome page's twilight: pinpricks far
  behind the clouds, each twinkling at its own pace. Cloud cover hides them.
*/

import { Points } from '../../vendor/three.min.js';
import { COMMON_FRAGMENT, COMMON_VERTEX } from '../three/glsl.js';
import { lightMaterial } from '../three/materials.js';
import { pointCloud } from '../three/particles.js';
import { seededRandom } from '../three/textures.js';

const vertexShader = /* glsl */ `
${COMMON_VERTEX}
attribute vec2 aTwinkle;   // rate, phase
uniform float uIntensity;
varying float vAlpha;

void main() {
  float z = mix(-60.0, -90.0, position.z);
  vec2 extent = viewExtent(z) * 1.1;
  // Mostly in the upper part of the sky, thinning towards the horizon.
  vec3 world = vec3((position.x * 2.0 - 1.0) * extent.x, mix(-0.55, 1.0, position.y) * extent.y, z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  float bright = fract(position.x * 91.7 + position.y * 37.3);
  float twinkle = 0.55 + 0.45 * sin(uTime * aTwinkle.x + aTwinkle.y);
  vAlpha = uIntensity * twinkle * mix(0.3, 1.0, bright * bright) * mix(0.45, 1.0, position.y);
  gl_PointSize = mix(1.0, 2.4, bright * bright * bright) * uPixelRatio;
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
  gl_FragColor = vec4(0.92, 0.95, 1.0, a * readable(0.7));
}
`;

export class Stars {
  constructor({ scene, shared, capability }) {
    const random = seededRandom(11);
    this.count = capability.stars;
    this.geometry = pointCloud(this.count, () => [random(), random(), random()], [
      ['aTwinkle', 2, () => [0.6 + random() * 2.2, random() * Math.PI * 2]],
    ]);
    this.material = lightMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uIntensity: { value: 0 } },
    });
    this.points = new Points(this.geometry, this.material);
    this.points.renderOrder = 0;
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(p) {
    const amount = p.stars * Math.max(0, 1 - p.clouds * p.cloudAlpha * 1.6);
    this.points.visible = amount > 0.005;
    this.material.uniforms.uIntensity.value = amount;
  }

  setDensity(share) {
    this.geometry.setDrawRange(0, Math.round(this.count * share));
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
