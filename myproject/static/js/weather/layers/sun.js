/*
  Sun and moon: a small bright disc in a wide, soft glow, far behind
  everything else. They sit at the top right, where the CSS sky already
  puts its light, and drift slowly. Around midday the sun is just above the
  top edge, so it lights the scene without competing with the page's own
  weather drawing; near sunrise and sunset it sinks into view, lower and
  warmer (see mapper.js). Faint rays turn around it in clear air. Clouds in
  front veil the disc first and the glow last, so an overcast sky still
  feels lit from one side.
*/

import { Mesh, PlaneGeometry, Vector3 } from '../../vendor/three.min.js';
import { CAMERA_Z, TAN_HALF_FOV } from '../three/scene-manager.js';
import { COMMON_FRAGMENT, NOISE } from '../three/glsl.js';
import { lightMaterial } from '../three/materials.js';

const DEPTH = -70;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${COMMON_FRAGMENT}
${NOISE}
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uIntensity;
uniform float uDisc;     // radius of the disc, as a share of the quad's half-width
uniform float uRays;
uniform float uVeil;     // how much cloud is in front
uniform float uMottle;   // surface markings, for the moon
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float clear = 1.0 - uVeil;

  // The CSS sky already glows around this spot, so the wide glow stays faint.
  float wide = exp(-r * 4.5) * 0.28;
  float bloom = exp(-r * 18.0) * 0.7;
  // Behind cloud or mist the disc spreads into a soft, pale smudge.
  float disc = 1.0 - smoothstep(uDisc * mix(0.8, 0.1, uVeil), uDisc * mix(1.0, 2.6, uVeil), r);
  float surface = mix(1.0, 0.8 + 0.2 * valueNoise(p / uDisc * 2.2 + 3.0), uMottle);

  // A faint, slow shimmer of rays, only in clear air.
  float angle = atan(p.y, p.x);
  float rays = pow(0.5 + 0.5 * sin(angle * 7.0 + sin(angle * 2.0 + uTime * 0.04) * 1.6 + uTime * 0.015), 4.0);
  rays *= exp(-r * 6.0) * smoothstep(uDisc, uDisc * 3.0, r) * 0.08 * uRays;

  vec3 light = uGlow * (wide * (0.6 + 0.4 * clear) + bloom * (0.35 + 0.65 * clear) + rays * clear * clear)
             + uCore * disc * surface * mix(0.45, 1.0, clear);
  light *= uIntensity * (1.0 - smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(light, 1.0);
}
`;

// Midday light is kept near white: yellow added to the blue sky turns olive.
const SUN_CORE = [new Vector3(1, 0.99, 0.96), new Vector3(1, 0.88, 0.69)];  // midday, sunset
const SUN_GLOW = [new Vector3(1, 0.95, 0.85), new Vector3(1, 0.62, 0.38)];

export class Sun {
  constructor({ scene, shared }) {
    this.geometry = new PlaneGeometry(1, 1);
    this.sun = this.body(scene, shared, { disc: 0.045, rays: 1, mottle: 0 });
    this.moon = this.body(scene, shared, { disc: 0.04, rays: 0, mottle: 1 });
    this.moon.material.uniforms.uCore.value.set(0.93, 0.95, 1);
    this.moon.material.uniforms.uGlow.value.set(0.56, 0.64, 0.85);
  }

  body(scene, shared, { disc, rays, mottle }) {
    const material = lightMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...shared,
        uCore: { value: new Vector3() },
        uGlow: { value: new Vector3() },
        uIntensity: { value: 0 },
        uDisc: { value: disc },
        uRays: { value: rays },
        uVeil: { value: 0 },
        uMottle: { value: mottle },
      },
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  update(p, frame) {
    const extentY = TAN_HALF_FOV * (CAMERA_Z - DEPTH);
    const extentX = extentY * frame.aspect;
    const t = frame.time;
    // A slow wander of a few pixels, so the sun never looks pinned on.
    const x = (p.sunX * 2 - 1) * extentX + Math.sin(t * 0.011) * extentX * 0.012;
    const y = (1 - p.sunY * 2) * extentY + Math.cos(t * 0.013) * extentY * 0.01;
    const size = extentY * 1.9;
    const veil = Math.min(p.clouds * p.cloudAlpha * 1.4 + p.fog * 0.9, 0.95);

    this.place(this.sun, p.sun * 0.85, x, y, size, veil);
    this.place(this.moon, p.moon * 0.55, x, y, size, veil);

    const sun = this.sun.material.uniforms;
    sun.uCore.value.lerpVectors(SUN_CORE[0], SUN_CORE[1], p.warmth);
    sun.uGlow.value.lerpVectors(SUN_GLOW[0], SUN_GLOW[1], p.warmth);
  }

  place(mesh, amount, x, y, size, veil) {
    mesh.visible = amount > 0.002;
    if (!mesh.visible) return;
    mesh.position.set(x, y, DEPTH);
    mesh.scale.set(size, size, 1);
    mesh.material.uniforms.uIntensity.value = amount;
    mesh.material.uniforms.uVeil.value = veil;
  }

  dispose() {
    this.geometry.dispose();
    this.sun.material.dispose();
    this.moon.material.dispose();
  }
}
