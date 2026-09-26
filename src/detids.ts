import * as THREE from 'three';
import { DataSource } from './data';

// DetIds from the Fireworks reco geometry (tools/detids.mjs), matched to sim parts by
// position: the nearest DetId centre to a part's centre. Approximate by nature.

const CELL = 0.05; // grid cell, m

const DETECTORS = ['', 'Tracker', 'Muon', 'ECAL', 'HCAL', 'Calo', 'MTD'];
const SUBDET: Record<number, Record<number, string>> = {
  1: { 1: 'TBPX (barrel pixel)', 2: 'TFPX/TEPX (forward pixel)' },
  2: { 1: 'DT', 2: 'CSC', 3: 'RPC', 4: 'GEM', 5: 'ME0' },
  3: { 1: 'EB', 2: 'EE', 3: 'ES' },
  4: { 1: 'HB', 2: 'HE', 3: 'HO', 4: 'HF' },
  6: { 1: 'BTL', 2: 'ETL' },
};

export function describeDetId(id: number) {
  const det = id >>> 28,
    sub = (id >>> 25) & 7;
  return { detector: DETECTORS[det] ?? `det ${det}`, subdetector: SUBDET[det]?.[sub] ?? `subdet ${sub}` };
}

export class DetIds {
  private ids: Uint32Array;
  private xyz: Float32Array;
  private grid = new Map<number, number[]>();

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
}
