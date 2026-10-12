import * as THREE from 'three';
import { DataSource } from './data';

// DetIds from the Fireworks reco geometry (tools/detids.mjs), matched to sim parts by
// position: the nearest DetId centre to a part's centre. Approximate by nature.

const CELL = 0.05; // grid cell, m

// DetId::Detector codes (bits 28-31); HGCAL (8-11) is not in detids.bin
const DETECTORS = ['', 'Tracker', 'Muon', 'ECAL', 'HCAL', 'Calo', 'MTD', '', 'HGCAL', 'HGCAL', 'HGCAL', 'HGCAL'];
const SUBDET: Record<number, Record<number, string>> = {
  // the Phase-2 outer tracker reuses the TID (endcap) and TOB (barrel) codes
  1: { 1: 'TBPX (barrel pixel)', 2: 'TFPX/TEPX (forward pixel)', 4: 'TEDD (OT endcap)', 5: 'TBPS/TB2S (OT barrel)' },
  2: { 1: 'DT', 2: 'CSC', 3: 'RPC', 4: 'GEM', 5: 'ME0' },
  3: { 1: 'EB', 2: 'EE', 3: 'ES' },
  4: { 1: 'HB', 2: 'HE', 3: 'HO', 4: 'HF' },
  5: { 1: 'calo tower', 2: 'ZDC' },
};

export function describeDetId(id: number) {
  const det = id >>> 28,
    sub = (id >>> 25) & 7;
  // MTD is Forward/FastTime (6/1); barrel or endcap sits in bits 23-24
  const mtd = det === 6 && sub === 1 ? ['', 'BTL', 'ETL'][(id >>> 23) & 3] : '';
  return {
    detector: DETECTORS[det] || `det ${det}`,
    subdetector: mtd || SUBDET[det]?.[sub] || `subdet ${sub}`,
  };
}

// viewer subsystems (tools/convert.mjs GROUPS) that hold each detector's parts
const GROUPS: Record<number, Record<number, string[]>> = {
  1: { 1: ['it'], 2: ['it'], 4: ['ot'], 5: ['ot'] },
  2: { 1: ['dt'], 2: ['csc'], 3: ['rpc'], 4: ['gem'], 5: ['gem'] },
  3: { 1: ['ecal'], 2: ['ecal'], 3: ['ecal'] },
  4: { 1: ['hcal'], 2: ['hcal'], 3: ['hcal'], 4: ['hf'] },
  5: { 1: ['ecal', 'hcal', 'hf', 'hgcal'], 2: ['zdc'] }, // calo towers span the calorimeters
};

/** subsystems a DetId's part can be in, or null if unknown */
export function groupsOf(id: number) {
  const det = id >>> 28,
    sub = (id >>> 25) & 7;
  const mtd = det === 6 && sub === 1 ? ['', 'btl', 'etl'][(id >>> 23) & 3] : '';
  return mtd ? [mtd] : (GROUPS[det]?.[sub] ?? null);
}

export class DetIds {
  private ids: Uint32Array;
  private xyz: Float32Array;
  private grid = new Map<number, number[]>();
  private index?: Map<number, number>; // id -> row, built on first lookup

  static async load(base: string) {
    return new DetIds(await DataSource.for(base).buffer('detids.bin'));
  }

  /** from the layout written by tools/detids.mjs: uint32 id, float32 x, y, z (m) per DetId */
  static fromBuffer(buf: ArrayBuffer) {
    return new DetIds(buf);
  }

  private constructor(buf: ArrayBuffer) {
    const n = buf.byteLength / 16,
      u = new Uint32Array(buf),
      f = new Float32Array(buf);
    this.ids = new Uint32Array(n);
    this.xyz = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      this.ids[i] = u[4 * i];
      this.xyz.set(f.subarray(4 * i + 1, 4 * i + 4), 3 * i);
      const key = this.key(f[4 * i + 1], f[4 * i + 2], f[4 * i + 3]);
      const cell = this.grid.get(key);
      if (cell) cell.push(i);
      else this.grid.set(key, [i]);
    }
  }

  private key(x: number, y: number, z: number) {
    const q = (v: number) => Math.floor(v / CELL) + 512;
    return (q(x) * 1024 + q(y)) * 1024 + q(z);
  }

  /** nearest DetId centre within `tol` metres of p, or null */
  nearest(p: THREE.Vector3, tol: number) {
    const r = Math.ceil(tol / CELL),
      q = (v: number) => Math.floor(v / CELL);
    let best = -1,
      bestD = tol * tol;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const cell = this.grid.get(((q(p.x) + dx + 512) * 1024 + q(p.y) + dy + 512) * 1024 + q(p.z) + dz + 512);
          if (!cell) continue;
          for (const i of cell) {
            const d =
              (this.xyz[3 * i] - p.x) ** 2 + (this.xyz[3 * i + 1] - p.y) ** 2 + (this.xyz[3 * i + 2] - p.z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
    return best < 0 ? null : { id: this.ids[best], distance: Math.sqrt(bestD) };
  }

  /** the DetId a part's info card shows: the nearest centre to the part's centre */
  matchPart(sphere: THREE.Sphere) {
    return this.nearest(sphere.center, 0.5 * sphere.radius + 0.02);
  }

  /** centre of a DetId in metres, or null if it is not listed */
  centre(id: number) {
    if (!this.index) {
      this.index = new Map();
      for (let i = 0; i < this.ids.length; i++) this.index.set(this.ids[i], i);
    }
    const i = this.index.get(id);
    return i === undefined ? null : new THREE.Vector3().fromArray(this.xyz, 3 * i);
  }

  /** true if no other DetId centre is strictly closer to p than this one's */
  closestTo(p: THREE.Vector3, id: number) {
    const c = this.centre(id);
    if (!c) return false;
    const d = c.distanceTo(p),
      other = this.nearest(p, d);
    return !other || other.id === id || other.distance >= d;
  }
}

/**
 * Of the parts whose bounding sphere contains a DetId's centre, the one that stands for it:
 * preferably one whose info card shows this DetId (closest centre first). Otherwise, where
 * a DetId is a readout cell rather than a volume, the part whose bounding box (from `box`)
 * is nearest the centre, the smallest if several contain it. Only parts centred within
 * `reach` are checked for the first rule, which keeps the grid search small.
 */
export function bestPart<T extends { sphere: THREE.Sphere }>(
  parts: T[],
  id: number,
  ids: DetIds,
  box: (part: T, at: THREE.Vector3) => { distance: number; volume: number },
  reach = 0.5,
) {
  const at = ids.centre(id);
  if (!at) return null;
  const inside = parts
    .map((p) => ({ p, d: p.sphere.center.distanceTo(at) }))
    .filter(({ p, d }) => d <= p.sphere.radius)
    .sort((a, b) => a.d - b.d || a.p.sphere.radius - b.p.sphere.radius);
  for (const { p, d } of inside)
    if (d <= Math.min(reach, 0.5 * p.sphere.radius + 0.02) && ids.closestTo(p.sphere.center, id)) return p;
  let best: { p: T; distance: number; volume: number } | null = null;
  for (const { p } of inside) {
    const b = box(p, at);
    if (!best || b.distance < best.distance || (b.distance === best.distance && b.volume < best.volume))
      best = { p, ...b };
  }
  return best?.p ?? null;
}

/** a DetId typed as decimal or 0x hex, or null */
export function parseDetId(text: string) {
  const s = text.trim().toLowerCase();
  const n = /^0x[0-9a-f]{1,8}$/.test(s) ? parseInt(s, 16) : /^\d{1,10}$/.test(s) ? Number(s) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 0xffffffff ? n : null;
}
