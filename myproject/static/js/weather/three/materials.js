/*
  The two ways the layers blend onto the page. The canvas is transparent
  and sits over the CSS sky, so the drawing buffer's alpha decides how much
  of that sky still shows through.
*/

import {
  AddEquation, CustomBlending, NormalBlending, OneFactor, ShaderMaterial, SrcAlphaFactor, ZeroFactor,
} from '../../vendor/three.min.js';

const SHARED = { transparent: true, depthTest: false, depthWrite: false };

// Light (sun, stars, lightning, rain catching the light): adds to whatever
// is behind it and leaves the canvas's alpha alone, so it brightens the CSS
// sky as well as the clouds.
export function lightMaterial(options) {
  return new ShaderMaterial({
    ...SHARED,
    ...options,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

// Matter (clouds, fog, snow): covers what is behind it.
export function veilMaterial(options) {
  return new ShaderMaterial({ ...SHARED, ...options, blending: NormalBlending });
}
