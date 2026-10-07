/*
  Weather manager: holds the scene's current numbers and blends them towards
  a new weather over about two seconds.

  The parts change in a natural order rather than all at once. Whatever is
  leaving (the sun, the rain) goes in the first half, clouds and the colour
  of the air change in the middle, and whatever is arriving comes in the
  second half. So sun to rain reads: the sun fades, clouds gather, the air
  darkens, rain begins. The CSS sky colours follow the same middle stretch
  (see the transition on body in style.css).

  Each search is a new page, so the numbers on screen are saved to
  sessionStorage as a page is left, and the next page starts from them.
*/

import { COLOR_KEYS, LIGHT_KEYS, PARAM_KEYS, PRECIP_KEYS, preset } from './scenes.js';

const STORAGE_KEY = 'skysnap:weather';
// Read by the inline script in templates/main.html, so the CSS sky can start
// from the last page's colours too.
const SKY_KEY = 'skysnap:sky';

const DURATION = 1.8;  // seconds

// Stretches of the transition, as fractions of it.
const LEAVE = [0, 0.5];
const MIDDLE = [0.15, 0.85];
const ARRIVE = [0.5, 1];

const STAGED = new Set([...LIGHT_KEYS, ...PRECIP_KEYS]);
const IS_COLOR = new Set(COLOR_KEYS);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function copyInto(target, source) {
  for (const key of PARAM_KEYS) {
    if (IS_COLOR.has(key)) {
      target[key][0] = source[key][0];
      target[key][1] = source[key][1];
      target[key][2] = source[key][2];
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function clone(params) {
  return copyInto(preset('default'), params);
}

export class WeatherManager {
  // "from" is where to start: the last page's weather, or a quiet sky.
  // Without it the scene simply shows "target".
  constructor(target, from = null) {
    this.current = clone(from || target);
    this.from = clone(this.current);
    this.target = clone(target);
    this.stretch = PARAM_KEYS.map(() => MIDDLE);
    this.progress = 1;
    if (from) this.setTarget(target);
  }

  setTarget(next) {
    copyInto(this.from, this.current);
    copyInto(this.target, next);
    PARAM_KEYS.forEach((key, i) => {
      if (STAGED.has(key)) this.stretch[i] = next[key] < this.current[key] ? LEAVE : ARRIVE;
      else this.stretch[i] = MIDDLE;
    });
    this.progress = 0;
  }

  // Jumps to the end of the transition (reduced motion).
  finish() {
    if (this.progress < 1) {
      copyInto(this.current, this.target);
      this.progress = 1;
    }
  }

  update(dt) {
    if (this.progress >= 1) return;
    this.progress = Math.min(1, this.progress + dt / DURATION);
    const { from, target, current } = this;
    if (this.progress === 1) {
      copyInto(current, target);  // land exactly, so rounding never builds up
      return;
    }
    for (let i = 0; i < PARAM_KEYS.length; i++) {
      const key = PARAM_KEYS[i];
      const [start, end] = this.stretch[i];
      const t = easeInOut(Math.min(Math.max((this.progress - start) / (end - start), 0), 1));
      if (IS_COLOR.has(key)) {
        for (let c = 0; c < 3; c++) current[key][c] = from[key][c] + (target[key][c] - from[key][c]) * t;
      } else {
        current[key] = from[key] + (target[key] - from[key]) * t;
      }
    }
  }
}

// A first visit builds the weather up from an empty sky in the same colours.
export function quietFrom(target) {
  const quiet = clone(target);
  for (const key of [...STAGED, 'clouds']) quiet[key] = 0;
  return quiet;
}

// The weather the last page showed, or null. Anything malformed (an older
// version of the site, a hand-edited value) is ignored.
export function loadPrevious() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return null;
    const params = preset('default');
    for (const key of PARAM_KEYS) {
      const value = saved[key];
      if (IS_COLOR.has(key)) {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
        params[key] = value.slice();
      } else {
        if (!Number.isFinite(value)) return null;
        params[key] = value;
      }
    }
    return params;
  } catch {
    return null;
  }
}

export function savePrevious(params, sky) {
  try {
    const rounded = {};
    for (const key of PARAM_KEYS) {
      rounded[key] = IS_COLOR.has(key)
        ? params[key].map((c) => Math.round(c * 1000) / 1000)
        : Math.round(params[key] * 1000) / 1000;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rounded));
    sessionStorage.setItem(SKY_KEY, sky);
  } catch {
    // Storage can be full or switched off; the next page then simply starts fresh.
  }
}
