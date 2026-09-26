import * as THREE from 'three';
import type { Detector, Drawable } from './detector';

// CPU picking: cast a ray through the pixel and test what is currently drawn. The GPU
// ID-buffer approach crashes ANGLE/Metal on this scene, and a clicked ray only touches
// a handful of instances once bounding spheres have rejected the rest.

export interface Hit {
  drawable: Drawable;
  item: number;
  point?: THREE.Vector3;
}

const _ray = new THREE.Ray();
const _local = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _sphere = new THREE.Sphere();

/** nearest ray parameter over the triangles in [from, to) of an indexed mesh, or Infinity */
export function rayTriangles(
  ray: THREE.Ray,
  pos: Float32Array,
  idx: ArrayLike<number>,
  from: number,
  to: number,
  both: boolean,
  best: number,
  onHit?: (tri: number) => void,
) {
  const o = ray.origin,
    d = ray.direction;
  for (let t = from; t < to; t++) {
    const a = 3 * idx[3 * t],
      b = 3 * idx[3 * t + 1],
      c = 3 * idx[3 * t + 2];
    const e1x = pos[b] - pos[a],
      e1y = pos[b + 1] - pos[a + 1],
      e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a],
      e2y = pos[c + 1] - pos[a + 1],
      e2z = pos[c + 2] - pos[a + 2];
    const px = d.y * e2z - d.z * e2y,
      py = d.z * e2x - d.x * e2z,
      pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (both ? Math.abs(det) < 1e-12 : det < 1e-12) continue; // parallel, or back face
    const inv = 1 / det;
    const sx = o.x - pos[a],
      sy = o.y - pos[a + 1],
      sz = o.z - pos[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y,
      qy = sz * e1x - sx * e1z,
      qz = sx * e1y - sy * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (s > 0 && s < best) {
      best = s;
      onHit?.(t);
    }
  }
  return best;
}

export class Picker {
  private ray = new THREE.Raycaster();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private det: Detector,
  ) {}

  /** a point on the cut-away side of every clipping plane is not drawn (clipIntersection) */
  private clipped(p: THREE.Vector3) {
    const planes = this.det.planes;
    return planes.length > 0 && planes.every((pl) => pl.distanceToPoint(p) < 0);
  }

  /** x, y in CSS pixels relative to the canvas */
  pick(camera: THREE.PerspectiveCamera, x: number, y: number): Hit | null {
    const el = this.renderer.domElement,
      w = el.clientWidth,
      h = el.clientHeight;
    this.ray.setFromCamera(new THREE.Vector2((2 * x) / w - 1, 1 - (2 * y) / h), camera);
    const world = this.ray.ray;

    let best = camera.far,
      hit: Hit | null = null;
    // a hit inside the cut-away region does not count; retry beyond it
    const consider = (drawable: Drawable, item: number, local: THREE.Ray, t: number, toWorld: THREE.Matrix4 | null) => {
      _p.copy(local.direction).multiplyScalar(t).add(local.origin);
      if (toWorld) _p.applyMatrix4(toWorld);
      if (this.clipped(_p)) return false;
      best = toWorld ? _p.distanceTo(world.origin) : t;
      hit = { drawable, item, point: _p.clone() };
      return true;
    };

    for (const d of this.det.drawables) {
      if (!d.object.visible || !d.object.layers.test(camera.layers)) continue;
      const both = (d.object.material as THREE.Material).side === THREE.DoubleSide;
      const geo = d.object.geometry,
        pos = geo.getAttribute('position').array as Float32Array;

      if (d.instanced) {
        const mesh = d.object as THREE.InstancedMesh,
          bs = geo.boundingSphere!,
          idx = geo.index!.array;
        const tris = idx.length / 3,
          all = mesh.instanceMatrix.array as Float32Array;
        for (let s = 0; s < mesh.count; s++) {
          _m.fromArray(all, 16 * s);
          _inv.copy(_m).invert();
          _local.copy(world).applyMatrix4(_inv);
          // instances are rigid, so distances measured locally equal world distances
          if (!_local.intersectSphere(_sphere.copy(bs), _p)) continue;
          if (_p.distanceTo(_local.origin) > best + bs.radius) continue;
          let t = rayTriangles(_local, pos, idx, 0, tris, both, Infinity);
          while (t < best) {
            if (consider(d, d.slots![s], _local, t, _m)) break;
            // step past the clipped surface and look again
            const o = _local.origin.clone().addScaledVector(_local.direction, t + 1e-4);
            const next = new THREE.Ray(o, _local.direction);
            const t2 = rayTriangles(next, pos, idx, 0, tris, both, Infinity);
            if (!isFinite(t2)) break;
            t += 1e-4 + t2;
          }
        }
      } else {
        const idx = geo.index!.array,
          part = geo.getAttribute('partId').array;
        let cur = world.clone();
        let offset = 0;
        for (let guard = 0; guard < 8; guard++) {
          let tri = -1;
          const t = rayTriangles(cur, pos, idx, 0, idx.length / 3, both, best - offset, (i) => {
            tri = i;
          });
          if (tri < 0 || !isFinite(t)) break;
          const item = part[idx[3 * tri]];
          if (consider(d, item, cur, t, null)) {
            best = offset + t;
            break;
          }
          // clipped: continue the ray past this surface
          offset += t + 1e-4;
          cur = new THREE.Ray(cur.origin.clone().addScaledVector(cur.direction, t + 1e-4), cur.direction);
        }
      }
    }
    return hit;
  }
}
