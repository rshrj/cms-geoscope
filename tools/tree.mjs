import { openFile } from 'jsroot';
const [, , pattern, maxDepth = 4, maxKids = 6] = process.argv;
const f = await openFile('geometry/cmsSimGeom-Run4D127.root');
const mgr = await f.readObject(f.fKeys.find((k) => k.fClassName === 'TGeoManager').fName);
const find = (v) => {
  for (const n of v.fNodes?.arr ?? []) {
    if (n.fName.startsWith(pattern)) return n;
    const r = find(n.fVolume);
    if (r) return r;
  }
};
const count = (v) => 1 + (v.fNodes?.arr ?? []).reduce((a, n) => a + count(n.fVolume), 0);
const show = (n, d) => {
  const v = n.fVolume,
    m = v.fMedium?.fMaterial,
    s = v.fShape;
  console.log(
    `${'  '.repeat(d)}${n.fName} [${s._typename} ${s.fDX.toFixed(1)}x${s.fDY.toFixed(1)}x${s.fDZ.toFixed(1)}] ${m?.fName} ρ=${m?.fDensity?.toFixed(3)} sub=${count(v) - 1}`,
  );
  if (d >= +maxDepth) return;
  const seen = new Set();
  let k = 0;
  for (const c of v.fNodes?.arr ?? []) {
    if (seen.has(c.fVolume)) continue;
    seen.add(c.fVolume);
    if (k++ >= +maxKids) {
      console.log(`${'  '.repeat(d + 1)}...`);
      break;
    }
    show(c, d + 1);
  }
};
show(find(mgr.fMasterVolume), 0);
