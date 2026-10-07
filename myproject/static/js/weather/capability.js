/*
  Decides whether this device should draw the 3D weather, and how much of it.

  Phones get the lightest tier: fewer particles, the canvas at CSS-pixel
  resolution and 30 frames a second, to spare the battery. The scene is
  soft by nature, so drawing it below the screen's full density costs
  little in looks. If frames still run slow, SceneManager steps quality
  down further while the page is open.

  ?sky3d=off turns the scene off (to see the CSS fallback), and
  ?sky3d=low|medium|high forces a tier, even on software rendering.
*/

const TIERS = {
  high:   { pixelRatio: 1.5,  fps: 60, rain: 4000, snow: 1500, stars: 900, motes: 70, splashes: 120, cloudSheets: 3, fogSheets: 3, bolts: true },
  medium: { pixelRatio: 1.25, fps: 60, rain: 2200, snow: 950,  stars: 600, motes: 50, splashes: 60,  cloudSheets: 3, fogSheets: 3, bolts: true },
  low:    { pixelRatio: 1,    fps: 30, rain: 1100, snow: 520,  stars: 360, motes: 30, splashes: 0,   cloudSheets: 2, fogSheets: 2, bolts: false },
};

function pickTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;  // only Chromium reports it
  const touch = matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width, screen.height);
  if (cores <= 2 || memory <= 2) return 'low';
  if (touch && shortSide < 600) return 'low';                  // phones
  if (touch || cores <= 4 || memory <= 4) return 'medium';     // tablets and modest laptops
  return 'high';
}

export function detectCapability() {
  const choice = new URLSearchParams(location.search).get('sky3d');
  const connection = navigator.connection || {};
  // Three.js is the biggest download on the page, so data savers skip it.
  const saveData = connection.saveData === true || /2g$/.test(connection.effectiveType || '');
  const forced = Object.hasOwn(TIERS, choice);
  const tier = forced ? choice : pickTier();

  return {
    ...TIERS[tier],
    tier,
    forced,
    enabled: typeof WebGL2RenderingContext !== 'undefined' && choice !== 'off' && (forced || !saveData),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
