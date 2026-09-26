import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DetIds, describeDetId } from '../src/detids';

function table(rows: [number, number, number, number][]) {
  const buf = new ArrayBuffer(16 * rows.length),
    u = new Uint32Array(buf),
    f = new Float32Array(buf);
  rows.forEach(([id, x, y, z], i) => {
    u[4 * i] = id;
    f.set([x, y, z], 4 * i + 1);
  });
  return buf;
}

describe('DetIds', () => {
  const ids = DetIds.fromBuffer(
    table([
      [111, 0, 0, 0],
      [222, 1, 0, 0],
      [333, 10, 10, 10],
      [444, -1, -2, -3],
    ]),
  );

  it('finds the nearest centre within the tolerance', () => {
    expect(ids.nearest(new THREE.Vector3(0.9, 0, 0), 0.5)).toMatchObject({ id: 222 });
    expect(ids.nearest(new THREE.Vector3(-1, -2.1, -3), 0.5)).toMatchObject({ id: 444 });
  });

  it('returns null when nothing is close enough', () => {
    expect(ids.nearest(new THREE.Vector3(5, 5, 5), 0.5)).toBeNull();
  });

  it('searches across grid cells', () => {
    expect(ids.nearest(new THREE.Vector3(0.49, 0, 0), 0.6)).toMatchObject({ id: 111 });
  });
});

describe('describeDetId', () => {
  it('decodes detector and subdetector bits', () => {
    // Ecal (3), barrel (1): (3 << 28) | (1 << 25)
    expect(describeDetId(((3 << 28) | (1 << 25)) >>> 0)).toEqual({ detector: 'ECAL', subdetector: 'EB' });
    expect(describeDetId(((1 << 28) | (1 << 25)) >>> 0).subdetector).toContain('TBPX');
  });

  it('falls back to numbers for unknown codes', () => {
    expect(describeDetId(((1 << 28) | (6 << 25)) >>> 0).subdetector).toBe('subdet 6');
  });
});
