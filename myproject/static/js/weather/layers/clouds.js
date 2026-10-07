/*
  Clouds: three sheets of cloud at different depths, each shaped from the
  tileable noise texture. Far sheets cover the upper sky with small, slow
  clouds; the near one frames the top edge with large ones that pass
  faster, which gives depth as they drift and as the camera moves.

  A cloud is wherever the noise rises above a threshold, so "clouds" (the
  cover, 0-1) lowers the threshold and cloud grows out of the sky rather
  than fading in. The noise is warped by a coarser copy of itself, so the
  shapes billow and never repeat. Each pixel is lit by comparing the cloud
  with itself a little towards the sun: edges facing the light are bright,
  the far sides and thick middles fall into shadow, and clouds near the sun
  catch its warmth. Lightning lights them from within.
*/

import { Mesh, PlaneGeometry, Vector2, Vector3 } from '../../vendor/three.min.js';
import { CAMERA_Z, TAN_HALF_FOV } from '../three/scene-manager.js';
import { COMMON_FRAGMENT } from '../three/glsl.js';
import { veilMaterial } from '../three/materials.js';

// low: the lowest the sheet reaches, in half-heights of the view (1 is the
// top edge). scale: noise repeats per world unit. speed: relative drift.
const SHEETS = [
  { z: -55, low: -0.15, scale: 0.03, speed: 0.6, alpha: 0.95, order: 10 },
  { z: -30, low: 0.1, scale: 0.038, speed: 1, alpha: 0.85, order: 30 },
  { z: -12, low: 0.55, scale: 0.045, speed: 1.6, alpha: 0.6, order: 60 },
];

const vertexShader = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
uniform sampler2D uNoise;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uSunTint;
uniform vec2 uSunPx;       // the sun's position, in drawing-buffer pixels
uniform vec2 uToSun;       // which way the light comes from, in noise space
uniform float uSunLight;
uniform float uPixelH;
uniform float uThreshold;  // the noise level at a cloud's edge (see coverageToThreshold)
uniform float uOpacity;
uniform float uDrift;
uniform float uSpeed;
uniform float uScale;
uniform float uSeed;
uniform float uExtentY;
uniform float uLow;
uniform float uLayerAlpha;
varying vec2 vWorld;

void main() {
  vec2 p = vWorld * vec2(1.0, 1.7) * uScale + vec2(uDrift * uSpeed + uSeed, uSeed * 0.61);
  vec2 warp = vec2(texture2D(uNoise, p * 0.45 + vec2(0.13, 0.71)).r,
                   texture2D(uNoise, p * 0.45 + vec2(0.57, 0.29)).r) - 0.5;
  vec2 q = p + warp * 0.25;
  float n = texture2D(uNoise, q).r * 0.78 + texture2D(uNoise, q * 1.9 + 0.37).r * 0.22;

  float density = smoothstep(uThreshold - 0.11, uThreshold + 0.11, n);
  float height = vWorld.y / uExtentY;
  density *= smoothstep(uLow - 0.15, uLow + 0.3, height);
  if (density < 0.003) discard;

  // The same cloud a step towards the sun: thinner there means this pixel
  // is on the lit side.
  float toward = texture2D(uNoise, q + uToSun).r * 0.78 + texture2D(uNoise, q * 1.9 + 0.37 + uToSun * 1.9).r * 0.22;
  float lit = clamp(0.5 + (n - toward) * 3.0, 0.0, 1.0);
  float thick = smoothstep(uThreshold, uThreshold + 0.35, n);
  vec3 color = mix(uShadow, uLit, clamp(lit * 0.6 + (1.0 - thick) * 0.4, 0.0, 1.0));

  float nearSun = exp(-length(gl_FragCoord.xy - uSunPx) / uPixelH * 3.5) * uSunLight;
  color += uSunTint * nearSun * (1.0 - thick * 0.6) * 0.55;
  color += vec3(0.85, 0.82, 1.0) * uFlash * (0.35 + 0.65 * lit);

  float a = density * mix(0.7, 1.0, thick) * uOpacity * uLayerAlpha * readable(0.4) * scrolled(0.55);
  gl_FragColor = vec4(color, a);
}
`;

const SUN_TINT = [new Vector3(1, 0.97, 0.92), new Vector3(1, 0.72, 0.48)];  // midday, sunset

// The cloud field's noise bunches around its middle, so a straight line
// from cover to threshold would show almost no cloud below half cover.
// These thresholds were measured from the field (the noise texture's seed
// and the shader's mix of samples) so that a cover of 0.2 really clouds
// about a fifth of the sky. Re-measure if either changes.
const COVER = [0, 0.05, 0.2, 0.5, 0.8, 0.95, 1];
const THRESHOLD = [0.95, 0.75, 0.636, 0.52, 0.41, 0.31, 0.15];

function coverageToThreshold(cover) {
  const c = Math.min(Math.max(cover, 0), 1);
  let i = 1;
  while (i < COVER.length - 1 && COVER[i] < c) i++;
  const t = (c - COVER[i - 1]) / (COVER[i] - COVER[i - 1]);
  return THRESHOLD[i - 1] + (THRESHOLD[i] - THRESHOLD[i - 1]) * t;
}

export class Clouds {
  constructor({ scene, shared, capability, textures }) {
    this.drift = 0;
    this.geometry = new PlaneGeometry(1, 1);
    // Everything but the sheet's own depth and scale is shared by all three.
    const common = {
      uNoise: { value: textures.noise },
      uLit: { value: new Vector3() },
      uShadow: { value: new Vector3() },
      uSunTint: { value: new Vector3() },
      uSunPx: { value: new Vector2() },
      uToSun: { value: new Vector2(0.03, 0.026) },
      uSunLight: { value: 0 },
      uThreshold: { value: 1 },
      uOpacity: { value: 0 },
      uDrift: { value: 0 },
    };
    this.common = common;
    this.sheets = SHEETS.slice(0, capability.cloudSheets).map((sheet, i) => {
      const material = veilMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...shared,
          ...common,
          uSpeed: { value: sheet.speed },
          uScale: { value: sheet.scale },
          uSeed: { value: i * 0.29 + 0.11 },
          uExtentY: { value: 1 },
          uLow: { value: sheet.low },
          uLayerAlpha: { value: sheet.alpha },
        },
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.userData.sheet = sheet;
      mesh.renderOrder = sheet.order;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    this.nearAllowed = true;
  }

  update(p, frame) {
    const u = this.common;
    this.drift = (this.drift + p.cloudSpeed * (p.wind < 0 ? -1 : 1) * 0.01 * frame.dt) % 1000;
    u.uDrift.value = this.drift;
    u.uThreshold.value = coverageToThreshold(p.clouds);
    u.uOpacity.value = p.cloudAlpha;
    u.uLit.value.fromArray(p.cloudLit);
    u.uShadow.value.fromArray(p.cloudShade);
    u.uSunTint.value.lerpVectors(SUN_TINT[0], SUN_TINT[1], p.warmth);
    u.uSunLight.value = p.sun;
    u.uSunPx.value.set(p.sunX * frame.width * frame.pixelRatio, (1 - p.sunY) * frame.height * frame.pixelRatio);
    const visible = p.clouds > 0.003 && p.cloudAlpha > 0.003;
    for (let i = 0; i < this.sheets.length; i++) {
      this.sheets[i].visible = visible && (this.nearAllowed || i < 2);
    }
  }

  // Each sheet spans the view's width at its depth, from its lowest clouds
  // to above the top edge, with room for the camera to move.
  resize(frame) {
    for (const mesh of this.sheets) {
      const { z, low } = mesh.userData.sheet;
      const extentY = TAN_HALF_FOV * (CAMERA_Z - z);
      const bottom = (low - 0.2) * extentY;
      const top = 1.35 * extentY;
      mesh.position.set(0, (top + bottom) / 2, z);
      mesh.scale.set(extentY * frame.aspect * 2.7, top - bottom, 1);
      mesh.material.uniforms.uExtentY.value = extentY;
    }
  }

  // The near sheet covers the most screen, so it goes first on slow devices.
  setDensity(share) {
    this.nearAllowed = share > 0.7;
  }

  dispose() {
    this.geometry.dispose();
    for (const mesh of this.sheets) mesh.material.dispose();
  }
}
