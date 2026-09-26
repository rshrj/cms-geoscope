// Reads the Fireworks reco geometry (one row per DetId) and writes public/data/detids.bin:
// per DetId, uint32 id + float32 x,y,z of its centre in metres. HGCAL cells are left out
// (millions of them, and the sim geometry only has whole wafers to match against).
import { openFile, treeProcess, TSelector } from 'jsroot';
import { writeFileSync } from 'node:fs';

const SKIP = new Set([8, 9, 10, 11, 12]); // HGCal EE / HSi / HSc / trigger
const file = await openFile(process.argv[2] ?? 'geometry/cmsRecoGeom-Run4D127.root');
const tree = await file.readObject('idToGeo;6');
const ids = [],
  pos = [];
const counts = new Map();

const sel = new TSelector();
for (const b of ['id', 'translation', 'points']) sel.addBranch(b);
sel.Begin = () => {};
sel.Process = function () {
  const { id, translation: t, points: p } = this.tgtobj;
  const det = id >>> 28;
  if (SKIP.has(det)) return;
  let x = t[0],
    y = t[1],
    z = t[2];
  if (!x && !y && !z) {
    // corner-point entries: centre of the 8 corners
    x = y = z = 0;
    for (let i = 0; i < 8; i++) {
      x += p[3 * i];
      y += p[3 * i + 1];
      z += p[3 * i + 2];
    }
    x /= 8;
    y /= 8;
    z /= 8;
  }
  ids.push(id >>> 0);
  pos.push(x / 100, y / 100, z / 100);
  counts.set(det, (counts.get(det) ?? 0) + 1);
};
sel.Terminate = () => {};
await treeProcess(tree, sel);

const n = ids.length,
  out = Buffer.alloc(16 * n);
for (let i = 0; i < n; i++) {
  out.writeUInt32LE(ids[i], 16 * i);
  for (let k = 0; k < 3; k++) out.writeFloatLE(pos[3 * i + k], 16 * i + 4 + 4 * k);
}
writeFileSync('public/data/detids.bin', out);
console.log(`${n} DetIds, ${(out.length / 1e6).toFixed(1)} MB`, Object.fromEntries(counts));
