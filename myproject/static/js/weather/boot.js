/*
  SkySnap's 3D weather: the entry point. Small on purpose, so it costs next
  to nothing where the scene can't run.

  It reads the weather the page was rendered with (the #weather-data JSON
  from base/home.html), maps it to a scene, and checks the device. Only
  then does it load Three.js and the scene (engine.js). Until the scene is
  ready, and for good if it fails, the page keeps its CSS sky: nothing here
  is needed to use SkySnap.

  It also finishes the hand-over started by the inline script in
  templates/main.html: that script shows the last page's sky colours, and
  this file lets them glide to this page's as the scene starts.
*/

import { detectCapability } from './capability.js';
import { loadPrevious, quietFrom, savePrevious } from './manager.js';
import { mapWeather } from './mapper.js';
import { hasScene } from './scenes.js';

const root = document.documentElement;
const LOADING_DELAY = 700;  // ms before the loading hint appears
const HANDOFF_LIMIT = 1200; // ms the old sky colours wait for the scene

function readWeather() {
  const node = document.getElementById('weather-data');
  if (!node) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

// Lets the CSS sky move from the last page's colours to this page's.
function releaseSky() {
  root.removeAttribute('data-sky-from');
}

// A quiet note in the corner, only if loading the scene takes a while.
function loadingHint() {
  let note = null;
  const timer = setTimeout(() => {
    note = document.createElement('div');
    note.className = 'sky3d-status';
    note.setAttribute('aria-hidden', 'true');
    note.textContent = 'Rendering sky';
    document.body.append(note);
    requestAnimationFrame(() => note.classList.add('is-visible'));
  }, LOADING_DELAY);
  return () => {
    clearTimeout(timer);
    if (!note) return;
    note.classList.remove('is-visible');
    setTimeout(() => note.remove(), 400);
  };
}

async function boot() {
  root.classList.add('sky3d-boot');  // tells the inline script this file has taken over

  const preview = new URLSearchParams(location.search).get('scene');
  const { scene, sky, params } = mapWeather(readWeather(), preview);
  root.dataset.weatherScene = scene;
  const previous = loadPrevious();
  savePrevious(params, sky);  // the next page starts from here, even if the scene never runs

  // ?scene= previews a look by hand, so the CSS sky changes to match it.
  if (hasScene(preview)) document.body.dataset.sky = sky;

  const releaseTimer = setTimeout(releaseSky, HANDOFF_LIMIT);
  const capability = detectCapability();
  let weatherScene = null;
  let hideHint = () => {};

  // Back to the CSS sky: its particles fade in again and the canvas goes.
  const fallback = (error) => {
    if (error) console.warn('SkySnap: the 3D weather is off.', error);
    hideHint();
    clearTimeout(releaseTimer);
    releaseSky();
    root.classList.remove('sky3d-handoff', 'sky3d-on');
    weatherScene?.dispose();
    weatherScene = null;
  };

  if (!capability.enabled) {
    fallback();
    return;
  }

  hideHint = loadingHint();
  try {
    const { WeatherScene } = await import('./engine.js');
    weatherScene = new WeatherScene({
      params,
      from: previous || quietFrom(params),
      capability,
      onFail: fallback,
    });
    await weatherScene.start();
  } catch (error) {
    fallback(error);
    return;
  }
  if (!weatherScene) return;  // failed while starting

  hideHint();
  clearTimeout(releaseTimer);
  root.dataset.sky3dTier = capability.tier;
  root.classList.add('sky3d-on');
  releaseSky();

  addEventListener('pagehide', (event) => {
    if (!weatherScene) return;
    savePrevious(weatherScene.current, sky);
    if (event.persisted) weatherScene.pause();
    else weatherScene.dispose();
  });
  addEventListener('pageshow', (event) => {
    if (!event.persisted || !weatherScene) return;
    savePrevious(weatherScene.current, sky);
    weatherScene.resume();
  });
}

boot().catch((error) => {
  console.warn('SkySnap: the 3D weather could not start.', error);
  root.classList.remove('sky3d-handoff', 'sky3d-on');
  root.removeAttribute('data-sky-from');
});
