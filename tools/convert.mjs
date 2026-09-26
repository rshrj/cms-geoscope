// Convert the CMS TGeo simulation geometry into compact per-subsystem binaries
// for the web viewer.
//
//   node tools/convert.mjs [geometry/cmsSimGeom-Run4D127.root] [--out public/data] [--stats]
//
// Every placed volume made of a non-gaseous material is drawn. Placements are grouped
// into "draws": one per (subsystem, volume, mirrored, occluder). Draws with many copies
// become GPU instances; rare ones are baked (pre-transformed and merged) per
// (subsystem, material class, occluder, cap) to keep the draw-call count low.
//
// Flags carried to the viewer:
//   nested  some ancestor is itself drawn, so the placement is hidden inside an opaque
//           solid and only matters when the detector is cut open (or when the group of
//           that nearest drawn ancestor, 'occluder', is hidden)
//   cap     the volume has no drawn daughters, i.e. it is solid all the way through;
//           the viewer fills its cut faces. Volumes with daughters render as shells.
//
// tree.json/tree.bin hold the full placement hierarchy for the inspector: every TGeo
// node in depth-first preorder as (volume id, copy number, depth), so a subtree is a
// contiguous range and parents follow from the depths. Each drawn instance and baked
// part records its placement index ('pl') into this list.
//
// Units: metres, CMS frame (x towards LHC centre, y up, z along the beam).

import { openFile } from 'jsroot';
import { createGeometry, geoCfg } from '../node_modules/jsroot/modules/geom/geobase.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => a.endsWith('.root')) ?? 'geometry/cmsSimGeom-Run4D127.root';
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'public/data';
const statsOnly = args.includes('--stats');

const GAS_DENSITY = 0.01; // g/cm3; below this a volume is a container, never drawn
const MIN_INSTANCES = 200; // draws with fewer copies are baked into merged meshes
const CM = 0.01;

// Subsystem of a placement = the nearest ancestor-or-self volume matching a rule.
// Order matters only among rules that can match the same name.
const GROUPS = [
  ['beampipe', 'Beam pipe', /^beampipe:/],
  ['it', 'Inner Tracker', /^pixbar:Phase2PixelBarrel$|^pixfwd:Phase2PixelEndcap$/],
  ['ot', 'Outer Tracker', /^pixbar:Phase2OTBarrel$|^pixfwd:Phase2OTForward$|^otst:/],
  ['btl', 'MTD barrel (BTL)', /^btl:/],
  ['etl', 'MTD endcap (ETL)', /^etl:/],
  ['ecal', 'ECAL barrel', /^(eregalgo|ebalgo|ectkcable):/],
  ['hgcal', 'HGCAL', /^hgcal\w*:|^caloBase:CALOEC/],
  ['hcal', 'HCAL', /^hcal(algo|barrelalgo|cablealgo|outeralgo):/],
  ['magnet', 'Solenoid', /^mgnt:/],
  ['yoke', 'Return yoke', /^muonYoke:|^cavern:YBFeet/],
  ['rpc', 'RPC', /^rpcf:|^mb\d:MB\w*RPC/],
  ['dt', 'Drift tubes', /^mb\d:|^mbCommon:|^mb4Shield:/],
  ['csc', 'CSC', /^csc:/],
  ['gem', 'GEM', /^(gem11|gem21|ge0|ge0shield):/],
  ['mshield', 'Muon shielding', /^mfshield:|^mf:RR/],
  ['hf', 'Forward calorimeter (HF)', /^hcalforwardalgo:/],
  ['fshield', 'Forward shielding', /^forwardshield:/],
  ['zdc', 'ZDC', /^zdc/],
  ['cavern', 'Cavern', /^cavern/],
];
const groupOf = (name) => GROUPS.find((g) => g[2].test(name))?.[0];

// Coarse material classes; the viewer maps (group, class) to a look.
const CLASSES = [
  ['crystal', /pbwo4|lyso|quartz|glass/i],
  ['silicon', /silicon(?!e)|sensi|_si\b/i],
  ['steel', /steel|iron/i],
  ['lead', /lead|tungsten|wcu/i],
  ['copper', /copper|brass|bronze/i],
  ['aluminium', /alumin(?!a|um_nitride)/i],
  ['scintillator', /scint|polystyrene|pvt/i],
  ['electronics', /hybrid|pcb|hexaboard|chip|asic|readout|electronic/i],
  ['cable', /cable|connector|service|cool|pipe|water/i],
  ['composite', /carbon|cfrp|cf_|kfib|epoxy|g10|fr4|peek|kapton|laird|nitride/i],
  ['plastic', /poly|rohacell|foam|honeycomb|bakelite|nomex|mylar|gel|glue|rubber/i],
];
const classOf = (m) =>
  CLASSES.find((c) => c[1].test(m.fName))?.[0] ??
  (m.fDensity > 6 ? 'steel' : m.fDensity > 2.2 ? 'aluminium' : 'plastic');

// ---------------------------------------------------------------- read geometry
console.time('read');
const file = await openFile(input);
const mgr = await file.readObject(file.fKeys.find((k) => k.fClassName === 'TGeoManager').fName);
console.timeEnd('read');

const isSolid = (v) => (v.fMedium?.fMaterial?.fDensity ?? 0) >= GAS_DENSITY;
const hasSolidDaughter = new Map();
const solidBelow = (v) => {
  if (!hasSolidDaughter.has(v))
    hasSolidDaughter.set(
      v,
      (v.fNodes?.arr ?? []).some((n) => isSolid(n.fVolume) || solidBelow(n.fVolume)),
    );
  return hasSolidDaughter.get(v);
};

// 3x4 affine matrices, row-major [r00 r01 r02 tx | r10 r11 r12 ty | r20 r21 r22 tz]
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function nodeMatrix(node) {
  const m = node.fMatrix,
    t = m?.fTranslation ?? [0, 0, 0];
  const r = (m?._typename === 'TGeoCombiTrans' ? m.fRotation?.fRotationMatrix : m?.fRotationMatrix) ?? [
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ];
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2]];
}
function mul(a, b) {
  const o = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    o[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return o;
}
const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

// World-space bounding box of a placed shape (from its TGeoBBox extent and origin).
function worldBox(s, w) {
  const d = [s.fDX, s.fDY, s.fDZ],
    o = s.fOrigin ?? [0, 0, 0],
    lo = [],
    hi = [];
  for (let i = 0; i < 3; i++) {
    const r = w.slice(4 * i, 4 * i + 3);
    const c = r[0] * o[0] + r[1] * o[1] + r[2] * o[2] + w[4 * i + 3];
    const h = Math.abs(r[0]) * d[0] + Math.abs(r[1]) * d[1] + Math.abs(r[2]) * d[2];
    lo.push(c - h);
    hi.push(c + h);
  }
  return { lo, hi };
}

// Per-instance visibility for the viewer's cut modes (quarter, half, octant), each of
// which removes the region where the listed coordinates are all positive. Bit i: part
// of the instance survives clipping; bit 3+i: its nearest drawn ancestor is cut open,
// so a nested instance can be seen. Bounding boxes make both tests conservative.
const CUTS = [[0, 1], [0], [0, 1, 2]];
function cutMask(box, encl) {
  let m = 0;
  CUTS.forEach((axes, i) => {
    if (!axes.every((a) => box.lo[a] > 0)) m |= 1 << i;
    if (encl && axes.every((a) => encl.hi[a] > 0)) m |= 8 << i;
  });
  return m;
}

// ---------------------------------------------------------------- traverse
console.time('traverse');
const draws = new Map(); // key -> { group, vol, flipped, nested, occluder, mats: number[][], masks: number[] }
const unassigned = new Map();
let placements = 0;
const volIds = new Map(),
  treeVol = [],
  treeCopy = [],
  treeDepth = [];
(function walk(vol, world, group, occluder, enclBox, copy, depth) {
  if (!volIds.has(vol)) volIds.set(vol, volIds.size);
  const pl = treeVol.length;
  treeVol.push(volIds.get(vol));
  treeCopy.push(copy);
  treeDepth.push(depth);
  group = groupOf(vol.fName) ?? group;
  const solid = isSolid(vol);
  let box = enclBox;
  if (solid) {
    box = worldBox(vol.fShape, world);
    placements++;
    if (!group) unassigned.set(vol.fName, (unassigned.get(vol.fName) ?? 0) + 1);
    const flipped = det3(world) < 0;
    const key = `${group}|${vol.fName}|${+flipped}|${occluder}`;
    let d = draws.get(key);
    if (!d)
      draws.set(
        key,
        (d = { group: group ?? 'other', vol, flipped, nested: !!occluder, occluder, mats: [], masks: [], pls: [] }),
      );
    d.mats.push(world);
    d.masks.push(cutMask(box, enclBox));
    d.pls.push(pl);
  }
  for (const n of vol.fNodes?.arr ?? [])
    walk(n.fVolume, mul(world, nodeMatrix(n)), group, solid ? (group ?? 'other') : occluder, box, n.fNumber, depth + 1);
})(mgr.fMasterVolume, IDENT, undefined, null, null, 1, 0);
console.timeEnd('traverse');

// ---------------------------------------------------------------- tessellate
// Segment count follows the shape's size: fine for large cylinders whose silhouettes
// are visible, coarse for the thousands of small pipes and cables.
const shapeSize = (s) => Math.max(s.fDX, s.fDY, s.fDZ);
const tessCache = new Map();
function tessellate(vol) {
  if (tessCache.has(vol)) return tessCache.get(vol);
  const r = shapeSize(vol.fShape);
  geoCfg('GradPerSegm', r > 200 ? 2 : r > 50 ? 3 : r > 10 ? 6 : r > 2 ? 10 : 20);
  const g = createGeometry(vol.fShape);
  const res = weld(g.getAttribute('position').array, g.getAttribute('normal')?.array);
  tessCache.set(vol, res);
  return res;
}

// Non-indexed triangles -> indexed, merging vertices with equal position and normal.
function weld(pos, nrm) {
  const n = pos.length / 3,
    map = new Map(),
    P = [],
    N = [],
    I = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i] * CM,
      y = pos[3 * i + 1] * CM,
      z = pos[3 * i + 2] * CM;
    const nx = Math.round((nrm ? nrm[3 * i] : 0) * 127),
      ny = Math.round((nrm ? nrm[3 * i + 1] : 0) * 127),
      nz = Math.round((nrm ? nrm[3 * i + 2] : 1) * 127);
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)},${nx},${ny},${nz}`;
    let idx = map.get(k);
    if (idx === undefined) {
      map.set(k, (idx = P.length / 3));
      P.push(x, y, z);
      N.push(nx, ny, nz);
    }
    I[i] = idx;
  }
  let lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], P[i + a]);
      hi[a] = Math.max(hi[a], P[i + a]);
    }
  return { pos: Float32Array.from(P), nrm: Int8Array.from(N), idx: I, tris: n / 3, lo, hi };
}

// Mirror a mesh through z = 0 (positions, normals, winding) for placements whose
// world matrix is a reflection; their instance matrix then becomes a proper rotation.
function mirrored(m) {
  const pos = m.pos.slice(),
    nrm = m.nrm.slice(),
    idx = m.idx.slice();
  for (let i = 2; i < pos.length; i += 3) {
    pos[i] = -pos[i];
    nrm[i] = -nrm[i];
  }
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return { ...m, pos, nrm, idx, lo: [m.lo[0], m.lo[1], -m.hi[2]], hi: [m.hi[0], m.hi[1], -m.lo[2]] };
}
const unflip = (w) => [w[0], w[1], -w[2], w[3], w[4], w[5], -w[6], w[7], w[8], w[9], -w[10], w[11]];

function quat(w) {
  // rotation part of a 3x4 matrix -> [x y z w]
  const [m00, m01, m02, , m10, m11, m12, , m20, m21, m22] = w,
    tr = m00 + m11 + m22;
  let x, y, z, s, q;
  if (tr > 0) {
    s = 0.5 / Math.sqrt(tr + 1);
    q = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, q);
  return [x / l, y / l, z / l, q / l];
}

// ---------------------------------------------------------------- stats
const byGroup = new Map();
for (const d of draws.values()) {
  const g = byGroup.get(d.group) ?? { inst: 0, instDraws: 0, baked: 0, bakedTris: 0, tris: 0, nestedTris: 0 };
  const t = tessellate(d.vol).tris * d.mats.length;
  g.tris += t;
  if (d.nested) g.nestedTris += t;
  if (d.mats.length >= MIN_INSTANCES) {
    g.inst += d.mats.length;
    g.instDraws++;
  } else {
    g.baked += d.mats.length;
    g.bakedTris += t;
  }
  byGroup.set(d.group, g);
}
console.log(`placements drawn: ${placements}, draws: ${draws.size}`);
console.log('group        instDraws  instances   baked  bakedTris  totalTris  outerTris');
for (const [k, g] of [...byGroup].sort((a, b) => b[1].tris - a[1].tris))
  console.log(
    k.padEnd(12),
    String(g.instDraws).padStart(9),
    String(g.inst).padStart(10),
    String(g.baked).padStart(7),
    (g.bakedTris / 1e6).toFixed(2).padStart(9) + 'M',
    (g.tris / 1e6).toFixed(2).padStart(9) + 'M',
    ((g.tris - g.nestedTris) / 1e6).toFixed(2).padStart(9) + 'M',
  );
if (unassigned.size) console.log('unassigned volumes:', [...unassigned].slice(0, 20));
if (statsOnly) process.exit(0);

// ---------------------------------------------------------------- write
class Bin {
  // little-endian binary builder with 4-byte alignment
  parts = [];
  size = 0;
  add(typed) {
    const off = this.size,
      bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    this.parts.push(bytes);
    this.size += bytes.length;
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) {
      this.parts.push(new Uint8Array(pad));
      this.size += pad;
    }
    return off;
  }
  bytes() {
    return Buffer.concat(this.parts);
  }
}
const meshRef = (bin, m) => ({
  pos: bin.add(m.pos),
  nrm: bin.add(m.nrm),
  idx: bin.add(m.pos.length / 3 < 65536 ? Uint16Array.from(m.idx) : m.idx),
  idx32: m.pos.length / 3 >= 65536,
  verts: m.pos.length / 3,
  tris: m.idx.length / 3,
});

mkdirSync(outDir, { recursive: true });
const manifest = { source: basename(input), created: new Date().toISOString(), units: 'm', groups: [] };

for (const [gid, label] of [...GROUPS, ['other', 'Other']]) {
  const gdraws = [...draws.values()].filter((d) => d.group === gid);
  if (!gdraws.length) continue;
  const bin = new Bin(),
    infos = [],
    instanced = [],
    bakedSets = new Map();
  let lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];

  for (const d of gdraws) {
    const base = tessellate(d.vol),
      mesh = d.flipped ? mirrored(base) : base;
    const mats = d.flipped ? d.mats.map(unflip) : d.mats;
    const mat = d.vol.fMedium.fMaterial,
      cls = classOf(mat),
      cap = !solidBelow(d.vol);
    for (const w of mats)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], w[a * 4 + 3] * CM);
        hi[a] = Math.max(hi[a], w[a * 4 + 3] * CM);
      }
    const info =
      infos.push({
        name: d.vol.fName,
        vol: volIds.get(d.vol),
        material: mat.fName,
        density: +mat.fDensity.toFixed(3),
        cls,
        nested: d.nested,
        occluder: d.occluder,
        cap,
      }) - 1;

    if (mats.length >= MIN_INSTANCES) {
      const t = new Float32Array(mats.length * 3),
        q = new Int16Array(mats.length * 4);
      mats.forEach((w, i) => {
        t.set([w[3] * CM, w[7] * CM, w[11] * CM], i * 3);
        q.set(
          quat(w).map((c) => Math.round(c * 32767)),
          i * 4,
        );
      });
      instanced.push({
        info,
        count: mats.length,
        mesh: meshRef(bin, mesh),
        t: bin.add(t),
        q: bin.add(q),
        cuts: bin.add(Uint8Array.from(d.masks)),
        pl: bin.add(Uint32Array.from(d.pls)),
      });
    } else {
      const key = `${cls}|${d.occluder}|${+cap}`;
      let s = bakedSets.get(key);
      if (!s)
        bakedSets.set(
          key,
          (s = { cls, nested: d.nested, occluder: d.occluder, cap, pos: [], nrm: [], idx: [], verts: 0, parts: [] }),
        );
      mats.forEach((w, k) => {
        const base = s.verts;
        for (let i = 0; i < mesh.pos.length; i += 3) {
          const x = mesh.pos[i],
            y = mesh.pos[i + 1],
            z = mesh.pos[i + 2];
          s.pos.push(
            w[0] * x + w[1] * y + w[2] * z + w[3] * CM,
            w[4] * x + w[5] * y + w[6] * z + w[7] * CM,
            w[8] * x + w[9] * y + w[10] * z + w[11] * CM,
          );
          const nx = mesh.nrm[i],
            ny = mesh.nrm[i + 1],
            nz = mesh.nrm[i + 2];
          s.nrm.push(
            Math.round(w[0] * nx + w[1] * ny + w[2] * nz),
            Math.round(w[4] * nx + w[5] * ny + w[6] * nz),
            Math.round(w[8] * nx + w[9] * ny + w[10] * nz),
          );
        }
        const firstTri = s.idx.length / 3;
        for (const i of mesh.idx) s.idx.push(base + i);
        s.verts += mesh.pos.length / 3;
        s.parts.push([firstTri, mesh.idx.length / 3, info, d.pls[k], w[3] * CM, w[7] * CM, w[11] * CM]);
      });
    }
  }

  // baked parts: parallel arrays of first triangle, triangle count, info, placement
  // and world position of the part's origin
  const baked = [...bakedSets.values()].map((s) => {
    const mesh = { pos: Float32Array.from(s.pos), nrm: Int8Array.from(s.nrm), idx: Uint32Array.from(s.idx) };
    const col = (i) => Uint32Array.from(s.parts, (p) => p[i]);
    return {
      cls: s.cls,
      nested: s.nested,
      occluder: s.occluder,
      cap: s.cap,
      mesh: meshRef(bin, mesh),
      parts: s.parts.length,
      firstTri: bin.add(col(0)),
      tris: bin.add(col(1)),
      info: bin.add(col(2)),
      pl: bin.add(col(3)),
      origin: bin.add(Float32Array.from(s.parts.flatMap((p) => p.slice(4)))),
    };
  });

  const bytes = bin.bytes(),
    fileName = `${gid}.bin`;
  writeFileSync(join(outDir, fileName), bytes);
  manifest.groups.push({ id: gid, label, file: fileName, bytes: bytes.length, lo, hi, infos, instanced, baked });
  console.log(
    `wrote ${fileName} ${(bytes.length / 1e6).toFixed(1)} MB (${instanced.length} instanced, ${baked.length} baked)`,
  );
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
console.log(`wrote manifest.json ${(JSON.stringify(manifest).length / 1e6).toFixed(1)} MB`);

// ---------------------------------------------------------------- tree
// Shape parameters for the inspector, in cm and degrees as stored by TGeo; dx/dy/dz are
// the bounding-box half-lengths.
function shapeInfo(s) {
  const r = (x) => (typeof x === 'number' ? +x.toFixed(4) : x);
  const p = { type: s._typename, dx: r(s.fDX), dy: r(s.fDY), dz: r(s.fDZ) };
  const pick = (...keys) => {
    for (const k of keys) if (s[k] !== undefined) p[k[1].toLowerCase() + k.slice(2)] = r(s[k]);
  };
  switch (s._typename) {
    case 'TGeoTube':
    case 'TGeoTubeSeg':
    case 'TGeoCtub':
      pick('fRmin', 'fRmax', 'fDz', 'fPhi1', 'fPhi2');
      break;
    case 'TGeoCone':
    case 'TGeoConeSeg':
      pick('fRmin1', 'fRmax1', 'fRmin2', 'fRmax2', 'fDz', 'fPhi1', 'fPhi2');
      break;
    case 'TGeoPcon':
    case 'TGeoPgon':
      pick('fPhi1', 'fDphi', 'fNz', 'fNedges');
      break;
    case 'TGeoTrd1':
    case 'TGeoTrd2':
      pick('fDx1', 'fDx2', 'fDy1', 'fDy2', 'fDz');
      break;
    case 'TGeoTrap':
      pick('fDz', 'fTheta', 'fPhi', 'fH1', 'fBl1', 'fTl1', 'fH2', 'fBl2', 'fTl2');
      break;
    case 'TGeoXtru':
      pick('fNvert', 'fNz');
      break;
    case 'TGeoCompositeShape': {
      const n = s.fNode;
      p.op = n?._typename?.replace('TGeo', '');
      p.left = n?.fLeft?._typename;
      p.right = n?.fRight?._typename;
      break;
    }
  }
  return p;
}
const volumes = [...volIds.keys()].map((v) => ({
  name: v.fName,
  material: v.fMedium?.fMaterial?.fName ?? null,
  density: v.fMedium ? +v.fMedium.fMaterial.fDensity.toFixed(4) : 0,
  shape: shapeInfo(v.fShape),
}));
{
  const bin = new Bin();
  const tree = {
    count: treeVol.length,
    vol: bin.add(Uint16Array.from(treeVol)),
    copy: bin.add(Uint32Array.from(treeCopy)),
    depth: bin.add(Uint8Array.from(treeDepth)),
    gasDensity: GAS_DENSITY,
    volumes,
  };
  const bytes = bin.bytes();
  writeFileSync(join(outDir, 'tree.bin'), bytes);
  writeFileSync(join(outDir, 'tree.json'), JSON.stringify(tree));
  console.log(
    `wrote tree.bin ${(bytes.length / 1e6).toFixed(1)} MB, tree.json ${(JSON.stringify(tree).length / 1e6).toFixed(1)} MB (${tree.count} placements, ${volumes.length} volumes)`,
  );
}
