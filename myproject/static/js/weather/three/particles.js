/*
  Geometry for the particle layers. Everything about a particle is decided
  once, here, as random numbers in buffer attributes; the shaders animate
  them from the time alone. So a frame costs a few uniform updates however
  many particles there are, and nothing is allocated while the scene runs.
*/

import {
  BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry,
} from '../../vendor/three.min.js';

// Fills a Float32Array of count * size numbers, calling fill() per item.
function fillArray(count, size, fill) {
  const array = new Float32Array(count * size);
  for (let i = 0; i < count; i++) {
    const values = fill(i);
    for (let c = 0; c < size; c++) array[i * size + c] = values[c];
  }
  return array;
}

/*
  Many copies of one quad, drawn in a single call. The quad runs from -0.5
  to 0.5 across (x) and from 0 to 1 along (y), so a streak's head is at
  y = 0 and its tail at y = 1. "attributes" lists [name, size, fill(i)].
*/
export function instancedQuads(count, attributes) {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  for (const [name, size, fill] of attributes) {
    geometry.setAttribute(name, new InstancedBufferAttribute(fillArray(count, size, fill), size));
  }
  geometry.instanceCount = count;
  return geometry;
}

/*
  A cloud of points. "position" holds each point's place across the view
  (x, y in 0-1) and its depth (z in 0-1, near to far); the shader turns
  that into world space. "attributes" lists any extra [name, size, fill(i)].
*/
export function pointCloud(count, place, attributes = []) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(fillArray(count, 3, place), 3));
  for (const [name, size, fill] of attributes) {
    geometry.setAttribute(name, new Float32BufferAttribute(fillArray(count, size, fill), size));
  }
  return geometry;
}
