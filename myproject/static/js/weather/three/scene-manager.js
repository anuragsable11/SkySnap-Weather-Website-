/*
  Scene manager: the renderer, camera and frame loop, and everything that
  ties them to the page.

  - The canvas is fixed behind the page, transparent, and never takes
    pointer events. It is as tall as the largest viewport (100lvh), so a
    phone's address bar sliding away doesn't resize it.
  - The camera drifts slowly, leans a little towards the pointer and sinks
    as the page scrolls. It only moves sideways, never turns, so nearer
    layers shift more than distant ones: parallax.
  - The loop pauses while the tab is hidden or the page sits in the
    back/forward cache, and steps quality down if frames run slow.
  - With reduced motion it draws single still frames instead of a loop.

  Layers are objects with update(params, frame), and optionally
  resize(frame), setDensity(share) and dispose().
*/

import { PerspectiveCamera, Scene, Vector3, Vector4, WebGLRenderer } from '../../vendor/three.min.js';

export const FOV = 50;
export const CAMERA_Z = 10;
export const TAN_HALF_FOV = Math.tan(((FOV / 2) * Math.PI) / 180);

// The page's main text. Layers thin out behind it (readable() in glsl.js).
const GUARD_SELECTOR = '.hero > :not(.hero-art), .intro-copy, .state';
const GUARD_PADDING = 16;  // CSS pixels
const GUARD_FEATHER = 90;

// Quality steps for slow devices: [resolution scale, share of particles].
const QUALITY_STEPS = [[1, 1], [0.85, 0.8], [0.7, 0.6], [0.55, 0.45]];

const damp = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt));

export class SceneManager {
  constructor({ capability, onFrame, onFail }) {
    this.capability = capability;
    this.onFrame = onFrame;
    this.onFail = onFail;
    this.reducedMotion = capability.reducedMotion;
    this.layers = [];
    this.started = false;
    this.running = false;
    this.disposed = false;
    this.quality = 0;
    this.minFrameMs = capability.fps < 60 ? 1000 / capability.fps - 2 : 0;
    this.last = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, idle: 99, energy: 0 };
    this.scrollY = window.scrollY;
    this.shake = 0;
    this.perf = { warmup: 2, total: 0, frames: 0 };
    this.guardDirty = true;

    // What layers get each frame. Mutated in place, never reallocated.
    this.frame = { dt: 0, time: 0, width: 1, height: 1, aspect: 1, pixelRatio: 1, reducedMotion: this.reducedMotion };

    const canvas = document.createElement('canvas');
    canvas.className = 'sky3d';
    canvas.setAttribute('aria-hidden', 'true');
    this.canvas = canvas;

    // Throws when WebGL 2 is missing or would only run in software; the
    // caller then keeps the CSS sky.
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: capability.tier === 'high' ? 'high-performance' : 'low-power',
      failIfMajorPerformanceCaveat: !capability.forced,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.set(0, 0, CAMERA_Z);

    // Uniforms every layer's material shares by reference (see glsl.js).
    this.shared = {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uTanHalfFov: { value: TAN_HALF_FOV },
      uCamZ: { value: CAMERA_Z },
      uPixelH: { value: 1 },
      uPixelRatio: { value: 1 },
      uPointer: { value: new Vector3() },
      uGuard: { value: new Vector4(-1e5, -1e5, -1e5, -1e5) },
      uGuardFeather: { value: GUARD_FEATHER },
      uFade: { value: 1 },
      uFlash: { value: 0 },
    };

    const sky = document.querySelector('.sky-fx');
    if (sky) sky.after(canvas);
    else document.body.prepend(canvas);

    this.tick = this.tick.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerOut = this.onPointerOut.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onMotionChange = this.onMotionChange.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.onContextRestored = this.onContextRestored.bind(this);

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('pointerout', this.onPointerOut, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.onMotionChange);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.guardElements = [...document.querySelectorAll(GUARD_SELECTOR)];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.guardObserver = new ResizeObserver(() => { this.guardDirty = true; });
    for (const element of this.guardElements) this.guardObserver.observe(element);
    document.fonts?.ready.then(() => { this.guardDirty = true; });

    this.resize();
  }

  add(layer) {
    this.layers.push(layer);
    layer.resize?.(this.frame);
    return layer;
  }

  // Compiles every shader before the first frame, off the main thread
  // where the browser allows, so the page doesn't stutter as it loads.
  async prepare() {
    const hidden = [];
    this.scene.traverse((object) => {
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
    });
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      for (const object of hidden) object.visible = false;
    }
  }

  // Draws the first frame, then keeps going unless motion is reduced.
  begin() {
    this.started = true;
    this.renderStill();
    if (!this.reducedMotion) this.start();
  }

  start() {
    if (this.running || this.disposed || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.perf.warmup = 2;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const elapsed = now - this.last;
    if (elapsed < this.minFrameMs) return;
    this.last = now;
    try {
      this.step(Math.min(elapsed / 1000, 0.1));
      this.watchPerformance(elapsed);
    } catch (error) {
      this.fail(error);
    }
  }

  step(dt) {
    const frame = this.frame;
    frame.dt = dt;
    frame.time = (frame.time + dt) % 3600;
    frame.reducedMotion = this.reducedMotion;
    this.shared.uTime.value = frame.time;
    this.moveCamera(dt);
    if (this.guardDirty) this.measureGuard();
    this.onFrame(frame);
    this.renderer.render(this.scene, this.camera);
  }

  renderStill() {
    try {
      this.step(0);
    } catch (error) {
      this.fail(error);
    }
  }

  moveCamera(dt) {
    const p = this.pointer;
    const camera = this.camera;
    if (this.reducedMotion) {
      camera.position.set(0, 0, CAMERA_Z);
      this.shared.uPointer.value.set(0, 0, 0);
      return;
    }
    const t = this.frame.time;
    const screens = Math.min(this.scrollY / this.frame.height, 1.5);

    p.idle += dt;
    p.energy = damp(p.energy, p.idle < 2.5 ? 1 : 0, 2, dt);
    p.x = damp(p.x, p.tx, 2.2, dt);
    p.y = damp(p.y, p.ty, 2.2, dt);
    this.shake = damp(this.shake, 0, 5, dt);
    const jolt = Math.sin(t * 57) * this.shake;

    camera.position.x = p.x * 0.18 + Math.sin(t * 0.07) * 0.08 + jolt;
    camera.position.y = p.y * 0.1 + Math.cos(t * 0.05) * 0.05 - screens * 0.3 + jolt * 0.6;
    this.shared.uPointer.value.set(p.x, p.y, p.energy);
    this.shared.uFade.value = damp(this.shared.uFade.value, 1 - Math.min(screens, 1), 6, dt);
  }

  // A small nudge of the camera, for thunder.
  kick(amount) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  resize() {
    if (this.disposed) return;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const scale = QUALITY_STEPS[this.quality][0];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.capability.pixelRatio) * scale;

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    Object.assign(this.frame, { width, height, aspect: width / height, pixelRatio });
    this.shared.uAspect.value = width / height;
    this.shared.uPixelH.value = height * pixelRatio;
    this.shared.uPixelRatio.value = pixelRatio;
    this.shared.uGuardFeather.value = GUARD_FEATHER * pixelRatio;
    this.guardDirty = true;
    for (const layer of this.layers) layer.resize?.(this.frame);
    if (this.started && !this.running) this.renderStill();
  }

  // Finds the box around the page's main text, in drawing-buffer pixels
  // with the origin at the bottom left, as gl_FragCoord counts them.
  measureGuard() {
    this.guardDirty = false;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const element of this.guardElements) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }
    const { height, pixelRatio } = this.frame;
    if (left === Infinity || bottom < 0 || top > height) {
      this.shared.uGuard.value.set(-1e5, -1e5, -1e5, -1e5);
      return;
    }
    const pad = GUARD_PADDING;
    this.shared.uGuard.value.set(
      (left - pad) * pixelRatio,
      (height - bottom - pad) * pixelRatio,
      (right + pad) * pixelRatio,
      (height - top + pad) * pixelRatio,
    );
  }

  // Slow frames for a few seconds in a row step quality down, at most
  // three times. The first seconds after starting are skipped, since the
  // page itself is still busy loading.
  watchPerformance(elapsed) {
    const perf = this.perf;
    if (perf.warmup > 0) {
      perf.warmup -= elapsed / 1000;
      return;
    }
    perf.total += elapsed;
    perf.frames += 1;
    if (perf.frames < 90) return;
    const average = perf.total / perf.frames;
    perf.total = 0;
    perf.frames = 0;
    const budget = 1000 / this.capability.fps;
    if (average > budget * 1.4 && this.quality < QUALITY_STEPS.length - 1) {
      this.quality += 1;
      const share = QUALITY_STEPS[this.quality][1];
      for (const layer of this.layers) layer.setDensity?.(share);
      this.resize();
    }
  }

  onPointerMove(event) {
    const p = this.pointer;
    p.tx = (event.clientX / this.frame.width) * 2 - 1;
    p.ty = 1 - (event.clientY / this.frame.height) * 2;
    p.idle = 0;
  }

  onPointerOut(event) {
    if (event.relatedTarget) return;  // still inside the page
    const p = this.pointer;
    p.tx = 0;
    p.ty = 0;
    p.idle = 99;
  }

  onScroll() {
    this.scrollY = window.scrollY;
    this.guardDirty = true;
  }

  onVisibility() {
    if (document.hidden) this.stop();
    else if (!this.reducedMotion) this.start();
  }

  onMotionChange(event) {
    this.reducedMotion = event.matches;
    if (this.reducedMotion) {
      this.stop();
      this.renderStill();
    } else {
      this.start();
    }
  }

  onContextLost(event) {
    event.preventDefault();  // asks the browser to restore it
    this.stop();
  }

  onContextRestored() {
    this.resize();
    if (!this.reducedMotion) this.start();
  }

  fail(error) {
    this.stop();
    this.onFail?.(error);
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerout', this.onPointerOut);
    window.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver.disconnect();
    this.guardObserver.disconnect();
    for (const layer of this.layers) layer.dispose?.();
    this.layers.length = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
