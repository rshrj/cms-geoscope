import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DetIds, bestPart, describeDetId, groupsOf, parseDetId } from '../src/detids';

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

  it('names the Phase-2 outer tracker, which reuses the TID and TOB codes', () => {
    expect(describeDetId(((1 << 28) | (4 << 25)) >>> 0).subdetector).toContain('TEDD');
    expect(describeDetId(((1 << 28) | (5 << 25)) >>> 0).subdetector).toContain('TB2S');
  });

  it('tells BTL from ETL by the MTD subdetector bits', () => {
    expect(describeDetId(((6 << 28) | (1 << 25) | (1 << 23)) >>> 0)).toEqual({ detector: 'MTD', subdetector: 'BTL' });
    expect(describeDetId(((6 << 28) | (1 << 25) | (2 << 23)) >>> 0).subdetector).toBe('ETL');
  });

  it('falls back to numbers for unknown codes', () => {
    expect(describeDetId(((1 << 28) | (6 << 25)) >>> 0).subdetector).toBe('subdet 6');
  });
});

describe('groupsOf', () => {
  it('maps DetIds to the viewer subsystems that hold their parts', () => {
    expect(groupsOf(((4 << 28) | (3 << 25)) >>> 0)).toEqual(['hcal']); // HO, not the DT chambers around it
    expect(groupsOf(((2 << 28) | (3 << 25)) >>> 0)).toEqual(['rpc']);
    expect(groupsOf(((6 << 28) | (1 << 25) | (2 << 23)) >>> 0)).toEqual(['etl']);
  });

  it('leaves unknown codes unrestricted', () => {
    expect(groupsOf(((7 << 28) | (1 << 25)) >>> 0)).toBeNull();
  });
});

describe('parseDetId', () => {
  it('reads decimal and 0x hex', () => {
    expect(parseDetId('352588804')).toBe(352588804);
    expect(parseDetId(' 0x15040004 ')).toBe(0x15040004);
    expect(parseDetId('0XFFFFFFFF')).toBe(0xffffffff);
  });

  it('rejects names, zero and anything beyond 32 bits', () => {
    for (const s of ['', 'TBPX', '12abc', '0x', '0', '4294967296', '0x100000000', '1.5'])
      expect(parseDetId(s)).toBeNull();
  });
});

describe('DetId to part', () => {
  const ids = DetIds.fromBuffer(
    table([
      [111, 0, 0, 0],
      [222, 0.1, 0, 0],
      [333, 3, 0, 0],
    ]),
  );
  // a part's box defaults to a cube of side r around its centre
  const part = (
    name: string,
    x: number,
    r: number,
    box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0, 0), new THREE.Vector3(r, r, r)),
  ) => ({
    name,
    sphere: new THREE.Sphere(new THREE.Vector3(x, 0, 0), r),
    box,
  });
  const fit = (p: ReturnType<typeof part>, at: THREE.Vector3) => {
    const s = p.box.getSize(new THREE.Vector3());
    return { distance: p.box.distanceToPoint(at), volume: s.x * s.y * s.z };
  };

  it('looks up centres by id', () => {
    expect(ids.centre(222)?.toArray()).toEqual([expect.closeTo(0.1), 0, 0]);
    expect(ids.centre(999)).toBeNull();
  });

  it('knows whether another DetId is closer to a point', () => {
    expect(ids.closestTo(new THREE.Vector3(0.02, 0, 0), 111)).toBe(true);
    expect(ids.closestTo(new THREE.Vector3(0.08, 0, 0), 111)).toBe(false);
  });

  it('prefers the part whose own match is the DetId, then the closest centre', () => {
    const parts = [part('module', 0.105, 0.05), part('sensor', 0.1, 0.04), part('barrel', 0, 5)];
    expect(bestPart(parts, 222, ids, fit)?.name).toBe('sensor');
    expect(bestPart(parts, 111, ids, fit)?.name).toBe('barrel');
  });

  it('falls back to the smallest box containing the DetId', () => {
    // neither part's centre is nearer to 333 than to another DetId
    const parts = [
      part('wheel', 0, 4, new THREE.Box3(new THREE.Vector3(-4, -1, -1), new THREE.Vector3(4, 1, 1))),
      part('sector', 1.5, 2, new THREE.Box3(new THREE.Vector3(1, -1, -1), new THREE.Vector3(3.5, 1, 1))),
    ];
    expect(bestPart(parts, 333, ids, fit)?.name).toBe('sector');
  });

  it('skips a long thin part whose sphere, but not its box, reaches the DetId', () => {
    // the bar's sphere contains x = 3, its box stays near the axis; the tile's box holds it
    const bar = part('bar', 2, 1.5, new THREE.Box3(new THREE.Vector3(0.5, 0, -1), new THREE.Vector3(3.5, 0.01, -0.99)));
    const tile = part(
      'tile',
      2.9,
      1.2,
      new THREE.Box3(new THREE.Vector3(2.5, -0.5, -0.5), new THREE.Vector3(3.5, 0.5, 0.5)),
    );
    expect(bestPart([bar, tile], 333, ids, fit)?.name).toBe('tile');
  });

  it('finds nothing for parts that do not contain the DetId, or an unknown id', () => {
    expect(bestPart([part('far', 2, 0.1)], 111, ids, fit)).toBeNull();
    expect(bestPart([part('barrel', 0, 5)], 999, ids, fit)).toBeNull();
  });
});
