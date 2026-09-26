import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rayTriangles } from '../src/picker';

// one triangle in the z = 0 plane, counter-clockwise seen from +z
const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const idx = [0, 1, 2];
const ray = (z: number, dz: number, x = 0.2, y = 0.2) =>
  new THREE.Ray(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, dz));

describe('rayTriangles', () => {
  it('returns the distance to a front-facing hit', () => {
    expect(rayTriangles(ray(5, -1), pos, idx, 0, 1, false, Infinity)).toBeCloseTo(5);
  });

  it('ignores a back face unless both sides count', () => {
    expect(rayTriangles(ray(-5, 1), pos, idx, 0, 1, false, Infinity)).toBe(Infinity);
    expect(rayTriangles(ray(-5, 1), pos, idx, 0, 1, true, Infinity)).toBeCloseTo(5);
  });

  it('misses outside the triangle and behind the origin', () => {
    expect(rayTriangles(ray(5, -1, 2, 2), pos, idx, 0, 1, true, Infinity)).toBe(Infinity);
    expect(rayTriangles(ray(-5, -1), pos, idx, 0, 1, true, Infinity)).toBe(Infinity);
  });

  it('respects the best distance so far and reports the hit triangle', () => {
    expect(rayTriangles(ray(5, -1), pos, idx, 0, 1, false, 3)).toBe(3);
    let tri = -1;
    rayTriangles(ray(5, -1), pos, idx, 0, 1, false, Infinity, (t) => (tri = t));
    expect(tri).toBe(0);
  });
});
