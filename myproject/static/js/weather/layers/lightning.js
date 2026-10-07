/*
  Lightning, for storms. Strikes come at random, several seconds apart (more
  often in a heavier storm), never in a steady rhythm. A strike is a quick
  double flicker of light from somewhere behind the clouds: it lights the
  clouds, rain and mist (the shared uFlash uniform), washes the view with a
  soft glow centred on it, and nudges the camera. About half the strikes
  also show a distant forked bolt, partly hidden by the nearer clouds.

  Flashes are kept dim and brief, two pulses at most, well clear of the
  three-flashes-a-second limit for people sensitive to flashing light.
  With reduced motion there is no lightning.
*/

import {
  BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Vector2, Vector3,
} from '../../vendor/three.min.js';
import { CAMERA_Z, TAN_HALF_FOV } from '../three/scene-manager.js';
import { COMMON_FRAGMENT } from '../three/glsl.js';
import { lightMaterial } from '../three/materials.js';

const BOLT_DEPTH = -44;
const MAX_POINTS = 64;  // a bolt is a main path of 33 points and a branch of 17

const flashVertex = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const flashFragment = /* glsl */ `
${COMMON_FRAGMENT}
uniform vec2 uCenter;
uniform float uAspect;
uniform vec3 uColor;
varying vec2 vNdc;

void main() {
  vec2 d = (vNdc - uCenter) * vec2(uAspect, 1.0);
  float glow = 0.3 + 0.7 * exp(-dot(d, d) * 1.2);
  gl_FragColor = vec4(uColor * glow * uFlash * 0.2, 1.0);
}
`;

const boltVertex = /* glsl */ `
attribute float aSide;
attribute float aAlong;
varying float vSide;
varying float vAlong;
void main() {
  vSide = aSide;
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const boltFragment = /* glsl */ `
${COMMON_FRAGMENT}
uniform float uBolt;
uniform vec3 uColor;
varying float vSide;
varying float vAlong;

void main() {
  float s = abs(vSide);
  float core = exp(-s * s * 60.0);
  float glow = exp(-s * 3.5) * 0.35;
  float fade = mix(1.0, 0.3, vAlong);
  gl_FragColor = vec4(uColor * (core * 1.2 + glow) * fade * uBolt * readable(0.5), 1.0);
}
`;

// A jagged line from (x0, y0) to (x1, y1) by repeated midpoint displacement.
function jaggedPath(random, x0, y0, x1, y1, levels, roughness) {
  let points = [[x0, y0], [x1, y1]];
  let offset = Math.hypot(x1 - x0, y1 - y0) * roughness;
  for (let level = 0; level < levels; level++) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const shift = (random() - 0.5) * offset;
      next.push([(ax + bx) / 2 - ((by - ay) / length) * shift, (ay + by) / 2 + ((bx - ax) / length) * shift], points[i]);
    }
    points = next;
    offset *= 0.55;
  }
  return points;
}

export class Lightning {
  constructor({ scene, shared, capability, stage }) {
    this.shared = shared;
    this.stage = stage;
    this.bolts = capability.bolts;
    this.random = Math.random;
    this.timer = 2.5 + Math.random() * 4;  // the first strike comes soon after a storm arrives
    this.age = Infinity;                   // seconds since the last strike
    this.pulses = [[0, 1], [0.1, 0.6]];    // [delay, strength] of each flicker
    this.color = new Vector3(0.85, 0.83, 1);

    this.flash = new Mesh(
      new PlaneGeometry(2, 2),
      lightMaterial({
        vertexShader: flashVertex,
        fragmentShader: flashFragment,
        uniforms: { ...shared, uCenter: { value: new Vector2() }, uColor: { value: this.color } },
      }),
    );
    this.flash.renderOrder = 90;
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    scene.add(this.flash);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
    geometry.setAttribute('aSide', new BufferAttribute(new Float32Array(MAX_POINTS * 2), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(MAX_POINTS * 2), 1));
    geometry.setIndex(new BufferAttribute(new Uint16Array(MAX_POINTS * 6), 1));
    this.bolt = new Mesh(
      geometry,
      lightMaterial({
        vertexShader: boltVertex,
        fragmentShader: boltFragment,
        uniforms: { ...shared, uBolt: { value: 0 }, uColor: { value: this.color } },
      }),
    );
    this.bolt.renderOrder = 20;  // behind the middle and near clouds
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.showBolt = false;
    scene.add(this.bolt);
  }

  update(p, frame) {
    if (frame.reducedMotion || p.storm < 0.05) {
      this.age = Infinity;
      this.shared.uFlash.value = 0;
      this.flash.visible = false;
      this.bolt.visible = false;
      return;
    }

    this.timer -= frame.dt;
    if (this.timer <= 0) this.strike(p.storm, frame);
    this.age += frame.dt;

    let light = 0;
    for (let i = 0; i < this.pulses.length; i++) {
      const t = this.age - this.pulses[i][0];
      if (t >= 0) light += this.pulses[i][1] * Math.min(t / 0.015, 1) * Math.exp(-t * 14);
    }
    light = Math.min(light, 1) * p.storm;
    this.shared.uFlash.value = light;
    this.flash.visible = light > 0.002;
    this.bolt.visible = this.showBolt && this.age < 0.45;
    this.bolt.material.uniforms.uBolt.value = Math.min(light * 1.4, 1);
  }

  strike(storm, frame) {
    const random = this.random;
    this.age = 0;
    this.timer = (6 + random() * 10) / (0.6 + 0.4 * storm);
    this.pulses[1][0] = 0.08 + random() * 0.06;
    this.pulses[1][1] = 0.5 + random() * 0.3;

    const cx = -0.7 + random() * 1.6;
    const cy = 0.25 + random() * 0.6;
    this.flash.material.uniforms.uCenter.value.set(cx, cy);
    this.showBolt = this.bolts && random() < 0.5;
    if (this.showBolt) this.buildBolt(cx, cy, frame.aspect);
    this.stage.kick(0.02);
  }

  // Writes a fresh bolt into the preallocated buffers, as ribbons that glow
  // at the centre and fade at the edges (aSide) and towards the tip (aAlong).
  buildBolt(cx, cy, aspect) {
    const random = this.random;
    const extentY = TAN_HALF_FOV * (CAMERA_Z - BOLT_DEPTH);
    const x = cx * extentY * aspect;
    const top = extentY * 1.05;
    const end = cy * extentY - extentY * 0.45;
    const main = jaggedPath(random, x, top, x + (random() - 0.5) * extentY * 0.3, end, 5, 0.18);
    const fork = main[Math.floor(main.length * (0.3 + random() * 0.3))];
    const branch = jaggedPath(random, fork[0], fork[1], fork[0] + (random() - 0.5) * extentY * 0.5, fork[1] - extentY * 0.3, 4, 0.22);

    const geometry = this.bolt.geometry;
    const position = geometry.attributes.position.array;
    const side = geometry.attributes.aSide.array;
    const along = geometry.attributes.aAlong.array;
    const index = geometry.index.array;
    let vertex = 0;
    let indices = 0;

    for (const [path, width, startAlong] of [[main, 0.7, 0], [branch, 0.45, 0.4]]) {
      const first = vertex;
      for (let i = 0; i < path.length; i++) {
        const [px, py] = path[i];
        const [ax, ay] = path[Math.max(i - 1, 0)];
        const [bx, by] = path[Math.min(i + 1, path.length - 1)];
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / length) * width * 0.5;
        const ny = ((bx - ax) / length) * width * 0.5;
        const t = startAlong + (1 - startAlong) * (i / (path.length - 1));
        for (const s of [-1, 1]) {
          position.set([px + nx * s, py + ny * s, BOLT_DEPTH], vertex * 3);
          side[vertex] = s;
          along[vertex] = t;
          vertex += 1;
        }
        if (i > 0) {
          const a = first + (i - 1) * 2;
          index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], indices);
          indices += 6;
        }
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSide.needsUpdate = true;
    geometry.attributes.aAlong.needsUpdate = true;
    geometry.index.needsUpdate = true;
    geometry.setDrawRange(0, indices);
  }

  dispose() {
    for (const mesh of [this.flash, this.bolt]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
