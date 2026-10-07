/*
  GLSL shared by the layers' shaders. The uniforms declared here are the
  shared ones SceneManager updates once a frame (SceneManager.shared).

  Particles are placed relative to the camera's view rather than in a fixed
  box: each one has a position across the view (0-1) and a depth, and the
  shader scales that to the visible area at its depth. So every particle is
  on screen whatever the screen's shape, and none are wasted off the edges
  of a narrow phone.
*/

export const COMMON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAspect;
uniform float uTanHalfFov;
uniform float uCamZ;
uniform float uPixelH;
uniform float uPixelRatio;
uniform vec3 uPointer;

// Half the visible width and height at depth z, with the camera at rest.
vec2 viewExtent(float z) {
  float h = uTanHalfFov * (uCamZ - z);
  return vec2(h * uAspect, h);
}

// The world size of one drawing-buffer pixel at a distance from the camera.
float pixelSize(float dist) {
  return 2.0 * uTanHalfFov * dist / uPixelH;
}

// Moves a point a little away from the pointer, in screen space.
// uPointer is the pointer in NDC, with z fading to 0 when it rests.
vec4 avoidPointer(vec4 clip, float strength) {
  vec2 ndc = clip.xy / clip.w;
  vec2 away = (ndc - uPointer.xy) * vec2(uAspect, 1.0);
  float d = length(away);
  float push = uPointer.z * strength * (1.0 - smoothstep(0.0, 0.4, d));
  ndc += away / max(d, 0.0001) * push * vec2(1.0 / uAspect, 1.0);
  clip.xy = ndc * clip.w;
  return clip;
}
`;

export const COMMON_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform float uFade;
uniform vec4 uGuard;
uniform float uGuardFeather;

// How much of a layer to keep at this pixel: "keep" inside the box around
// the page's main text (uGuard, in drawing-buffer pixels), rising to all of
// it outside, so weather never sits at full strength behind the words.
float readable(float keep) {
  vec2 p = gl_FragCoord.xy;
  vec2 d = max(uGuard.xy - p, p - uGuard.zw);
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return mix(keep, 1.0, smoothstep(-uGuardFeather * 0.25, uGuardFeather, dist));
}

// Dims a layer as the page scrolls, so cards further down sit on a calmer
// sky. "low" is what is left a screen down.
float scrolled(float low) {
  return mix(low, 1.0, uFade);
}
`;

// Cheap hash noise for shaders that need a little texture without a lookup.
export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// A point that falls outside clip space, so the GPU skips the whole shape.
export const HIDDEN = 'vec4(2.0, 2.0, 2.0, 1.0)';
