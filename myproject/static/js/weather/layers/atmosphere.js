/*
  Atmosphere: sheets of mist at three depths that drift with the wind at
  different speeds, thicker towards the bottom of the view. Each sheet reads
  the tileable noise texture twice, at two scales moving apart, so the mist
  keeps changing shape without any per-pixel noise maths. A thin even haze
  under the wisps lowers the sky's contrast, the way real mist does.

  Every scene uses it: a trace of haze on clear days, rain's grey air, a
  storm's gloom, a whiteout in snow, and most of the picture in fog.
*/

import { Mesh, PlaneGeometry, Vector3 } from '../../vendor/three.min.js';
import { CAMERA_Z, TAN_HALF_FOV } from '../three/scene-manager.js';
import { COMMON_FRAGMENT } from '../three/glsl.js';
import { veilMaterial } from '../three/materials.js';

// Farthest first. scale is noise repeats per world unit; speed is relative drift.
const SHEETS = [
  { z: -34, alpha: 0.55, scale: 0.035, speed: 0.6, order: 25 },
  { z: -18, alpha: 0.45, scale: 0.05, speed: 1, order: 40 },
  { z: -7, alpha: 0.32, scale: 0.08, speed: 1.6, order: 50 },
];

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uDensity;
uniform float uDrift;
uniform float uSpeed;
uniform float uScale;
uniform float uLayerAlpha;
uniform float uSeed;
varying vec2 vUv;
varying vec2 vWorld;

void main() {
  vec2 p = vWorld * uScale + uSeed;
  float drift = uDrift * uSpeed;
  float n = texture2D(uNoise, p + vec2(drift, 0.0)).r * 0.62
          + texture2D(uNoise, p * 2.3 + vec2(-drift * 0.6, uTime * 0.004)).r * 0.38;
  float wisps = smoothstep(0.32, 0.78, n);
  float low = 1.0 - smoothstep(0.0, 1.0, vUv.y);
  float body = uDensity * (0.18 + 0.82 * wisps) * mix(0.35, 1.0, low);
  vec3 color = uColor + vec3(0.8, 0.78, 1.0) * uFlash * 0.25;
  gl_FragColor = vec4(color, body * uLayerAlpha * readable(0.45) * scrolled(0.6));
}
`;

export class Atmosphere {
  constructor({ scene, shared, capability, textures }) {
    this.drift = 0;
    this.geometry = new PlaneGeometry(1, 1);
    // Colour, density and drift are one uniform object shared by every sheet.
    const common = { uColor: { value: new Vector3() }, uDensity: { value: 0 }, uDrift: { value: 0 } };
    this.common = common;
    this.sheets = SHEETS.slice(0, capability.fogSheets).map((sheet, i) => {
      const material = veilMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...shared,
          ...common,
          uNoise: { value: textures.noise },
          uSpeed: { value: sheet.speed },
          uScale: { value: sheet.scale },
          uLayerAlpha: { value: sheet.alpha },
          uSeed: { value: i * 0.37 },
        },
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.position.z = sheet.z;
      mesh.renderOrder = sheet.order;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    this.nearAllowed = true;
  }

  update(p, frame) {
    this.drift = (this.drift + p.cloudSpeed * (p.wind < 0 ? -1 : 1) * 0.012 * frame.dt) % 1000;
    this.common.uDrift.value = this.drift;
    this.common.uDensity.value = p.fog;
    this.common.uColor.value.fromArray(p.fogColor);
    const visible = p.fog > 0.004;
    for (let i = 0; i < this.sheets.length; i++) {
      this.sheets[i].visible = visible && (this.nearAllowed || i < 2);
    }
  }

  // Each sheet covers the whole view at its depth, with room for the camera to move.
  resize(frame) {
    for (const mesh of this.sheets) {
      const extentY = TAN_HALF_FOV * (CAMERA_Z - mesh.position.z) * 1.35;
      mesh.scale.set(extentY * frame.aspect * 2, extentY * 2, 1);
    }
  }

  setDensity(share) {
    this.nearAllowed = share > 0.7;
  }

  dispose() {
    this.geometry.dispose();
    for (const mesh of this.sheets) mesh.material.dispose();
  }
}
