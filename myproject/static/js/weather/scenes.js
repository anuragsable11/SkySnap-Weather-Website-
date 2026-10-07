/*
  Scene presets: one per kind of weather. Each is a full set of the numbers
  the layers read, so any two can be blended during a transition (see
  manager.js). The mapper (mapper.js) picks one and adjusts it to the real
  conditions.

  Colours are sRGB hex, like the sky themes in style.css, because the canvas
  is drawn straight over that CSS sky. Cloud and fog colours stay only a few
  steps lighter than their sky so white text keeps its contrast on top.
*/

const BASE = {
  sun: 0,                 // sun disc and glow, 0-1
  moon: 0,                // moon disc and glow, 0-1
  warmth: 0.15,           // sunlight colour: 0 white-gold, 1 sunset orange
  sunX: 0.86,             // where the sun or moon sits, as a share of the
  sunY: 0.01,             //   screen from the left and from the top
  stars: 0,
  clouds: 0,              // share of the cloud banks that are showing
  cloudAlpha: 0.4,        // how solid they are
  cloudLit: '#c8d3e6',    // colour of their sunlit tops
  cloudShade: '#4a5872',  // and of their undersides
  cloudSpeed: 0.3,        // drift, in world units per second
  fog: 0.05,              // mist density
  fogColor: '#8090b0',
  rain: 0,                // share of the raindrops that are falling
  rainSize: 1,            // drop length and speed: drizzle is smaller
  snow: 0,
  storm: 0,               // how often and how brightly lightning flashes
  motes: 0,               // floating specks in the air
  moteColor: '#ffffff',
  wind: 0.15,             // sideways drift per unit of fall; the sign is the direction
};

const PRESETS = {
  sunny: {
    sun: 1, warmth: 0.15, clouds: 0.18, cloudAlpha: 0.3,
    cloudLit: '#eef4ff', cloudShade: '#8aa6cf', cloudSpeed: 0.25,
    fog: 0.05, fogColor: '#bfd4f2', motes: 0.45, moteColor: '#ffe3a8',
  },
  night: {
    moon: 1, sunX: 0.9, sunY: 0.05, stars: 1, clouds: 0.15, cloudAlpha: 0.25,
    cloudLit: '#9aa8c8', cloudShade: '#2a3555', cloudSpeed: 0.2,
    fog: 0.04, fogColor: '#5a6c99', motes: 0.15, moteColor: '#b8c8ff',
  },
  cloudy: {
    sun: 0.2, clouds: 0.85, cloudAlpha: 0.5,
    cloudLit: '#8592a8', cloudShade: '#3a4558', cloudSpeed: 0.35,
    fog: 0.16, fogColor: '#7d899e', motes: 0.1, moteColor: '#d8e0ec',
  },
  rain: {
    clouds: 0.9, cloudAlpha: 0.55, cloudLit: '#6b7b96', cloudShade: '#1f2c42', cloudSpeed: 0.45,
    fog: 0.26, fogColor: '#4a5f7e', rain: 0.7, wind: 0.2,
  },
  storm: {
    clouds: 1, cloudAlpha: 0.62, cloudLit: '#5a5578', cloudShade: '#15122a', cloudSpeed: 0.6,
    fog: 0.32, fogColor: '#3a3460', rain: 1, storm: 1, wind: 0.3,
  },
  snow: {
    clouds: 0.75, cloudAlpha: 0.42, cloudLit: '#d0dbee', cloudShade: '#6a7c9e', cloudSpeed: 0.25,
    fog: 0.22, fogColor: '#b9c7de', snow: 0.75, wind: 0.12,
  },
  mist: {
    sun: 0.3, clouds: 0.35, cloudAlpha: 0.3, cloudLit: '#b4bdcc', cloudShade: '#5b6578', cloudSpeed: 0.15,
    fog: 0.62, fogColor: '#a9b3c3', motes: 0.45, moteColor: '#dfe5ee', wind: 0.08,
  },
  // The welcome and error pages: a quiet twilight, like the CSS "default" sky.
  default: {
    stars: 0.55, clouds: 0.12, cloudAlpha: 0.2, cloudLit: '#8090c0', cloudShade: '#232f57',
    cloudSpeed: 0.18, fog: 0.06, fogColor: '#5c6aa0',
  },
};

// The CSS sky theme (body[data-sky] in style.css) that goes with each scene.
export const SCENE_SKY = {
  sunny: 'clear',
  night: 'night',
  cloudy: 'clouds',
  rain: 'rain',
  storm: 'storm',
  snow: 'snow',
  mist: 'mist',
  default: 'default',
};

export const PARAM_KEYS = Object.keys(BASE);
export const COLOR_KEYS = PARAM_KEYS.filter((key) => typeof BASE[key] === 'string');

// Light sources and particles leave first and arrive last when the weather
// changes, so the sky clears before the sun comes out (see manager.js).
export const LIGHT_KEYS = ['sun', 'moon', 'stars', 'motes'];
export const PRECIP_KEYS = ['rain', 'snow', 'storm'];

export function hasScene(name) {
  return Object.hasOwn(PRESETS, name);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// A fresh copy of a preset, with its colours as [r, g, b] in 0-1.
export function preset(name) {
  const values = { ...BASE, ...PRESETS[name] };
  for (const key of COLOR_KEYS) values[key] = hexToRgb(values[key]);
  return values;
}
