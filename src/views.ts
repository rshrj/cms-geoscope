import * as THREE from 'three';
import type { Stage } from './stage';

export const VIEW_POSES: Record<string, [THREE.Vector3Tuple, THREE.Vector3Tuple]> = {
  Overview: [
    [25, 11, 27],
    [0, -0.8, 0],
  ],
  Side: [
    [34, 0.01, 0],
    [0, 0, 0],
  ],
  'End-on': [
    [0.01, 0, 36],
    [0, 0, 0],
  ],
  Tracker: [
    [5.8, 2.7, 6.8],
    [0, 0, 0.3],
  ],
  Endcap: [
    [6.5, 3.2, 12.5],
    [0, 0, 4.2],
  ],
};

/** Animated camera moves: named views, framing a sphere, and free flights. */
export function createFlight({ camera, controls }: Pick<Stage, 'camera' | 'controls'>) {
  let flight: { from: THREE.Vector3[]; to: THREE.Vector3[]; t0: number } | null = null;
  controls.addEventListener('start', () => {
    flight = null;
  });

  function flyTo(position: THREE.Vector3, target: THREE.Vector3, instant = false) {
    if (instant) {
      flight = null;
      camera.position.copy(position);
      controls.target.copy(target);
      return;
    }
    flight = {
      from: [camera.position.clone(), controls.target.clone()],
      to: [position.clone(), target.clone()],
      t0: performance.now(),
    };
  }

  function fly(name: string, instant = false) {
    const [p, t] = VIEW_POSES[name];
    flyTo(new THREE.Vector3(...p), new THREE.Vector3(...t), instant);
  }

  /** keep the viewing direction and back off until the sphere fits the narrower fov */
  function frame(sphere: THREE.Sphere) {
    const vfov = THREE.MathUtils.degToRad(camera.fov),
      hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (Math.max(sphere.radius, 0.02) / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1;
    const dir = camera.position.clone().sub(controls.target).normalize();
    flyTo(sphere.center.clone().addScaledVector(dir, dist), sphere.center);
  }

  function step(now: number) {
    if (!flight) return;
    const u = Math.min(1, (now - flight.t0) / 1100),
      e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    camera.position.lerpVectors(flight.from[0], flight.to[0], e);
    controls.target.lerpVectors(flight.from[1], flight.to[1], e);
    if (u === 1) flight = null;
  }

  return {
    flyTo,
    fly,
    frame,
    step,
    get flying() {
      return flight !== null;
    },
  };
}
export type Flight = ReturnType<typeof createFlight>;
