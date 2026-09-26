import * as THREE from 'three';
import type { Detector } from './detector';
import type { Stage } from './stage';

export type Quality = 'high' | 'balanced' | 'fast';
export const isQuality = (q: unknown): q is Quality => q === 'high' || q === 'balanced' || q === 'fast';

const HIDDEN = 1; // camera sees layer 0 only; parts moved to layer 1 are skipped

/** Full / Balanced / Fast: resolution, post-processing and small-part culling. */
export function createQuality(stage: Stage, det: Detector) {
  const { camera, controls, renderer, ao, plain, smaa, canvas } = stage;
  let current: Quality = 'high';
  let direct = false; // Fast draws straight to the canvas
  let minPixels = 0; // parts smaller than this (at the orbit target's distance) are skipped

  function set(q: Quality) {
    current = q;
    direct = q === 'fast';
    minPixels = q === 'fast' ? 8 : q === 'balanced' ? 2 : 0;
    const dpr = devicePixelRatio;
    renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'balanced' ? Math.min(dpr, 1.5) : 1);
    ao.enabled = q !== 'fast';
    plain.enabled = q === 'fast';
    ao.configuration.halfRes = q === 'balanced';
    ao.configuration.aoSamples = q === 'high' ? 16 : 8;
    smaa.enabled = q !== 'fast';
    stage.resize();
  }

  /** call every frame: hide repeated parts that would cover only a few pixels */
  function applyCulling() {
    const h = canvas.clientHeight,
      focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const dist = Math.max(camera.position.distanceTo(controls.target), 0.1);
    for (const d of det.drawables) {
      if (!d.instanced) continue;
      const r = d.object.geometry.boundingSphere!.radius;
      const small = minPixels > 0 && (r * focal) / dist < minPixels;
      if (small !== d.object.layers.isEnabled(HIDDEN)) {
        if (small) d.object.layers.set(HIDDEN);
        else d.object.layers.set(0);
      }
    }
  }

  return {
    set,
    applyCulling,
    get current() {
      return current;
    },
    get direct() {
      return direct;
    },
  };
}
