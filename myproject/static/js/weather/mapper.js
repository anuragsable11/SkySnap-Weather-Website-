/*
  Weather mapper: turns the conditions the page was rendered with (the
  "scene" readings from base.views.build_weather) into a scene preset tuned
  to them.

  The OpenWeather condition code is the main signal, because it says how
  heavy the rain or snow is. When it is missing, the condition's name is
  matched loosely, then the page's CSS sky theme; anything still unknown
  gets the quiet default scene. Codes: https://openweathermap.org/weather-conditions
*/

import { SCENE_SKY, hasScene, hexToRgb, preset } from './scenes.js';

// Group 7xx: atmosphere. Each gets the mist scene with its own density, and
// a tint for the ones that are not water (smoke, dust, sand, ash).
const ATMOSPHERE = {
  701: { fog: 0.55 },                         // mist
  711: { fog: 0.6, fogColor: '#9d968e' },     // smoke
  721: { fog: 0.45, fogColor: '#b9b6ae' },    // haze
  731: { fog: 0.55, fogColor: '#c4ad8a' },    // sand and dust whirls
  741: { fog: 0.8 },                          // fog
  751: { fog: 0.6, fogColor: '#c6ac82' },     // sand
  761: { fog: 0.55, fogColor: '#bba78a' },    // dust
  762: { fog: 0.6, fogColor: '#8d8d8f' },     // volcanic ash
};

// Group 5xx: rain, by how heavy each code is.
const RAIN = { 500: 0.45, 501: 0.7, 502: 0.9, 503: 1, 504: 1, 520: 0.5, 521: 0.75, 522: 1, 531: 0.7 };

const NAMES = [
  [/thunder|tornado|squall/, 'storm'],
  [/drizzle|rain|shower/, 'rain'],
  [/snow|sleet/, 'snow'],
  [/mist|fog|haze|smoke|dust|sand|ash/, 'mist'],
  [/cloud|overcast/, 'cloudy'],
  [/clear|sun/, 'sunny'],
];

const BY_SKY = {
  clear: 'sunny', night: 'night', clouds: 'cloudy', rain: 'rain',
  storm: 'storm', snow: 'snow', mist: 'mist', default: 'default',
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const mix = (a, b, t) => a + (b - a) * t;

// Which scene a condition code calls for, and how strong. Null when there is no code.
function byCode(code, night) {
  if (!Number.isFinite(code)) return null;
  const step = Math.min(code % 10, 2);  // the last digit grades intensity in most groups
  switch (Math.floor(code / 100)) {
    case 2: {  // thunderstorm
      const dry = code >= 210 && code < 230;  // 21x and 221 bring little rain
      return { scene: 'storm', storm: [0.7, 0.85, 1][step], rain: dry ? 0.4 : [0.65, 0.85, 1][step], rainSize: code >= 230 ? 0.7 : 1 };
    }
    case 3:  // drizzle
      return { scene: 'rain', rain: 0.3 + Math.min(code % 10, 4) * 0.08, rainSize: 0.6 };
    case 5:
      if (code === 511) return { scene: 'rain', rain: 0.55, snow: 0.2 };  // freezing rain
      return { scene: 'rain', rain: RAIN[code] ?? 0.7 };
    case 6:
      if (code >= 611 && code <= 616) return { scene: 'snow', snow: 0.5, rain: 0.3 };  // sleet, rain and snow
      return { scene: 'snow', snow: [0.45, 0.75, 1][step] };
    case 7:
      if (code === 781) return { scene: 'storm', storm: 0.6, rain: 0.5 };  // tornado
      if (code === 771) return { scene: 'rain', rain: 0.55, gusty: true };  // squalls
      return { scene: 'mist', ...(ATMOSPHERE[code] ?? ATMOSPHERE[701]) };
    case 8: {
      const clear = night ? 'night' : 'sunny';
      if (code === 800) return { scene: clear, clouds: 0.04 };
      if (code === 801) return { scene: clear, clouds: 0.22 };  // few clouds
      if (code === 802) return { scene: clear, clouds: 0.45 };  // scattered
      return { scene: 'cloudy', clouds: code === 803 ? 0.75 : 1, sun: code === 803 ? 0.25 : 0.1 };
    }
    default:
      return null;
  }
}

function byName(name, night) {
  const text = String(name || '').toLowerCase();
  for (const [pattern, scene] of NAMES) {
    if (pattern.test(text)) return { scene: scene === 'sunny' && night ? 'night' : scene };
  }
  return null;
}

function bySky(sky) {
  return BY_SKY[sky] ? { scene: BY_SKY[sky] } : null;
}

// Fine-tunes a preset with the readings: cloud cover, wind, visibility and
// where the sun is in its day.
function adjust(params, data, scene, night, gusty) {
  if (Number.isFinite(data.clouds)) {
    const cover = clamp(data.clouds / 100);
    params.clouds = mix(params.clouds, cover, 0.5);
    if (['rain', 'storm', 'snow'].includes(scene)) params.clouds = Math.max(params.clouds, 0.6);
  }

  // Wind: the API gives where it blows from, in degrees. Read with north up
  // and the viewer facing it, a westerly blows left to right.
  const speed = gusty ? 15 : Number.isFinite(data.wind) ? data.wind : 3;
  const strength = clamp(speed / 15);
  const across = Number.isFinite(data.wind_deg) ? -Math.sin((data.wind_deg * Math.PI) / 180) : 1;
  params.wind = (across < 0 ? -1 : 1) * (0.08 + 0.5 * strength);
  params.cloudSpeed *= 0.6 + strength * 1.2;

  // Under 10 km of visibility the air thickens.
  if (Number.isFinite(data.visibility)) {
    params.fog = clamp(params.fog + (1 - clamp(data.visibility / 10000)) * 0.35);
  }

  // Around midday the sun rides just above the top edge, so only its light
  // shows (the page's own drawing is the sun you look at). Near sunrise and
  // sunset it sinks into view, lower and warmer.
  if (params.sun > 0 && !night && Number.isFinite(data.daylight)) {
    const height = Math.sin(clamp(data.daylight) * Math.PI);
    params.warmth = clamp(0.85 - height * 1.1, 0.05, 0.85);
    params.sunX = 0.8 + 0.12 * clamp(data.daylight);
    params.sunY = 0.13 - 0.15 * height;
  }

  // At night grey skies get a faint moon instead of a hidden sun, and the
  // clouds lose their daylight.
  if (night && scene !== 'night') {
    params.moon = Math.max(params.moon, params.sun * 0.7);
    params.sun = 0;
    params.motes *= 0.4;
    params.cloudLit = params.cloudLit.map((c) => c * 0.78);
    params.cloudShade = params.cloudShade.map((c) => c * 0.8);
  }
}

/*
  Returns { scene, sky, params }: the scene's name, the CSS sky theme to
  show with it, and the numbers for the layers. "override" is a scene name
  from the ?scene= preview parameter, used to try each look by hand.
*/
export function mapWeather(data, override) {
  if (override && hasScene(override)) {
    return { scene: override, sky: SCENE_SKY[override], params: preset(override) };
  }
  if (!data || typeof data !== 'object') {
    return { scene: 'default', sky: 'default', params: preset('default') };
  }

  const night = typeof data.icon === 'string' && data.icon.endsWith('n');
  const match = byCode(data.code, night) || byName(data.main, night) || bySky(data.sky) || { scene: 'default' };
  const { scene, gusty, ...tuning } = match;
  const params = preset(scene);

  for (const [key, value] of Object.entries(tuning)) {
    params[key] = typeof value === 'string' ? hexToRgb(value) : value;
  }
  if (scene !== 'default') adjust(params, data, scene, night, gusty);

  return { scene, sky: data.sky || SCENE_SKY[scene], params };
}
