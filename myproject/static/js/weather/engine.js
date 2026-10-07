/*
  The weather scene: the stage (renderer, camera, loop) with every layer on
  it, driven by the weather manager. boot.js loads this file only once it
  has decided the device should draw the scene, so Three.js is never
  downloaded otherwise.

  Back to front: stars, sun and moon, far clouds, lightning bolts, far mist,
  middle clouds, middle mist, rain and splashes, snow, near mist, near
  clouds, floating motes, and the lightning's glow over everything.
*/

import { Atmosphere } from './layers/atmosphere.js';
import { Clouds } from './layers/clouds.js';
import { Lightning } from './layers/lightning.js';
import { Motes } from './layers/motes.js';
import { Rain } from './layers/rain.js';
import { Snow } from './layers/snow.js';
import { Stars } from './layers/stars.js';
import { Sun } from './layers/sun.js';
import { WeatherManager } from './manager.js';
import { SceneManager } from './three/scene-manager.js';
import { createTextures } from './three/textures.js';

const LAYERS = [Stars, Sun, Clouds, Atmosphere, Rain, Snow, Motes, Lightning];

export class WeatherScene {
  // "from" is the weather to blend from (see manager.js), or null.
  constructor({ params, from, capability, onFail }) {
    this.stage = new SceneManager({ capability, onFail, onFrame: (frame) => this.update(frame) });
    try {
      this.weather = new WeatherManager(params, capability.reducedMotion ? null : from);
      this.textures = createTextures();
      const context = { stage: this.stage, scene: this.stage.scene, shared: this.stage.shared, capability, textures: this.textures };
      for (const Layer of LAYERS) this.stage.add(new Layer(context));
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  // The numbers on screen right now, mid-transition or not.
  get current() {
    return this.weather.current;
  }

  async start() {
    await this.stage.prepare();
    this.stage.begin();
  }

  update(frame) {
    if (frame.reducedMotion) this.weather.finish();
    else this.weather.update(frame.dt);
    const params = this.weather.current;
    for (const layer of this.stage.layers) layer.update(params, frame);
  }

  // The page went into the back/forward cache, or came back from it.
  pause() {
    this.stage.stop();
  }

  resume() {
    if (!this.stage.reducedMotion) this.stage.start();
  }

  dispose() {
    this.stage.dispose();
    this.textures?.dispose();
  }
}
