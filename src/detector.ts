import * as THREE from 'three';
import { Looks, groupStyle } from './looks';
import type { PlacementTree } from './tree';

// Data written by tools/convert.mjs.
interface MeshRef {
  pos: number;
  nrm: number;
  idx: number;
  idx32: boolean;
  verts: number;
  tris: number;
}
export interface PartInfo {
  name: string;
  vol: number;
  material: string;
  density: number;
  cls: string;
  nested: boolean;
  occluder: string | null;
  cap: boolean;
}
interface InstancedDraw {
  info: number;
  count: number;
  mesh: MeshRef;
  t: number;
  q: number;
  cuts: number;
  pl: number;
}
interface BakedDraw {
  cls: string;
  nested: boolean;
  occluder: string | null;
  cap: boolean;
  mesh: MeshRef;
  parts: number;
  firstTri: number;
  tris: number;
  info: number;
  pl: number;
  origin: number;
}
export interface GroupData {
  id: string;
  label: string;
  file: string;
  bytes: number;
  lo: number[];
  hi: number[];
  infos: PartInfo[];
  instanced: InstancedDraw[];
  baked: BakedDraw[];
}
export interface Manifest {
  source: string;
  created: string;
  units: string;
  groups: GroupData[];
}

export type CutMode = 'none' | 'quarter' | 'half' | 'octant';
const CUT_BIT: Record<CutMode, number> = { none: -1, quarter: 0, half: 1, octant: 2 };

/** Show only what matches, overriding the subsystem toggles. */
export type Isolation =
  | { kind: 'group'; group: string; label: string }
  | { kind: 'volume'; name: string; label: string }
  | { kind: 'subtree'; from: number; to: number; label: string; ranges?: [number, number][] }; // placements [from, to), or several such ranges

/**
 * One draw call. Instanced: one volume placed many times; "items" are instances.
 * Baked: pre-transformed parts merged into one mesh; "items" are parts.
 * Either way each item has a placement index into the PlacementTree.
 */
export class Drawable {
  selection = '';
  /** instanced: drawn slot -> instance index, as packed into instanceMatrix */
  slots?: Uint32Array;
  constructor(
    readonly id: number,
    readonly object: THREE.Mesh,
    readonly group: string,
    readonly nested: boolean,
    readonly occluder: string | null,
    readonly infos: PartInfo[],
    readonly pl: Uint32Array,
    readonly instanced?: { info: number; all: Float32Array; cuts: Uint8Array; trisEach: number },
    readonly baked?: {
      firstTri: Uint32Array;
      tris: Uint32Array;
      info: Uint32Array;
      origin: Float32Array;
      index: THREE.BufferAttribute;
    },
  ) {}

  get count() {
    return this.pl.length;
  }
  info(item: number) {
    return this.infos[this.instanced ? this.instanced.info : this.baked!.info[item]];
  }

  /** world transform of an item (identity for baked parts, whose vertices are in world space) */
  matrix(item: number, out = new THREE.Matrix4()) {
    return this.instanced ? out.fromArray(this.instanced.all, 16 * item) : out.identity();
  }

  /** world position of the item's placement origin */
  origin(item: number) {
    if (this.instanced) {
      const a = this.instanced.all,
        o = 16 * item;
      return new THREE.Vector3(a[o + 12], a[o + 13], a[o + 14]);
    }
    return new THREE.Vector3().fromArray(this.baked!.origin, 3 * item);
  }

  /** geometry of a single item, for highlighting */
  itemGeometry(item: number) {
    const g = this.object.geometry;
    if (this.instanced) return g;
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', g.getAttribute('position'));
    part.setAttribute('normal', g.getAttribute('normal'));
    part.setIndex(this.baked!.index);
    part.setDrawRange(3 * this.baked!.firstTri[item], 3 * this.baked!.tris[item]);
    return part;
  }

  /** bounding sphere of an item in world space */
  itemSphere(item: number) {
    if (this.instanced) {
      const s = this.object.geometry.boundingSphere!.clone();
      return s.applyMatrix4(this.matrix(item));
    }
    const pos = this.object.geometry.getAttribute('position'),
      idx = this.baked!.index.array;
    const box = new THREE.Box3(),
      v = new THREE.Vector3();
    const a = 3 * this.baked!.firstTri[item],
      b = a + 3 * this.baked!.tris[item];
    for (let i = a; i < b; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
    return box.getBoundingSphere(new THREE.Sphere());
  }
}

function geometry(buf: ArrayBuffer, r: MeshRef) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, r.pos, r.verts * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, r.nrm, r.verts * 3), 3, true));
  const Idx = r.idx32 ? Uint32Array : Uint16Array;
  g.setIndex(new THREE.BufferAttribute(new Idx(buf, r.idx, r.tris * 3), 1));
  g.computeBoundingSphere();
  return g;
}

// Instance transforms: float32 translation + int16-normalised quaternion.
function instanceMatrices(buf: ArrayBuffer, d: InstancedDraw) {
  const t = new Float32Array(buf, d.t, d.count * 3),
    q = new Int16Array(buf, d.q, d.count * 4);
  const m = new Float32Array(16 * d.count);
  for (let i = 0; i < d.count; i++) {
    let x = q[4 * i],
      y = q[4 * i + 1],
      z = q[4 * i + 2],
      w = q[4 * i + 3];
    const l = Math.hypot(x, y, z, w);
    x /= l;
    y /= l;
    z /= l;
    w /= l;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2,
      yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2,
      o = 16 * i;
    m[o] = 1 - (yy + zz);
    m[o + 1] = xy + wz;
    m[o + 2] = xz - wy;
    m[o + 3] = 0;
    m[o + 4] = xy - wz;
    m[o + 5] = 1 - (xx + zz);
    m[o + 6] = yz + wx;
    m[o + 7] = 0;
    m[o + 8] = xz + wy;
    m[o + 9] = yz - wx;
    m[o + 10] = 1 - (xx + yy);
    m[o + 11] = 0;
    m[o + 12] = t[3 * i];
    m[o + 13] = t[3 * i + 1];
    m[o + 14] = t[3 * i + 2];
    m[o + 15] = 1;
  }
  return m;
}

export class Detector {
  readonly root = new THREE.Group();
  readonly planes: THREE.Plane[] = [];
  readonly looks = new Looks(this.planes);
  readonly drawables: Drawable[] = [];
  manifest!: Manifest;
  tree?: PlacementTree;
  cut: CutMode = 'none';
  isolation: Isolation | null = null;
  /** world bounds and item count of what is currently drawn (updated by refresh) */
  bounds = new THREE.Box3();
  shownItems = 0;
  onChange?: () => void;
  private visible = new Set<string>();

  async load(base: string, onProgress: (done: number, total: number, label: string) => void) {
    this.manifest = await (await fetch(`${base}/manifest.json`)).json();
    const total = this.manifest.groups.reduce((a, g) => a + g.bytes, 0);
    let done = 0;
    for (const g of this.manifest.groups) {
      onProgress(done, total, g.label);
      const buf = await (await fetch(`${base}/${g.file}`)).arrayBuffer();
      this.build(g, buf);
      done += g.bytes;
      if (!groupStyle(g.id).hidden) this.visible.add(g.id);
      this.refresh();
    }
    onProgress(total, total, '');
  }

  private build(g: GroupData, buf: ArrayBuffer) {
    const node = new THREE.Group();
    node.name = g.id;
    for (const d of g.instanced) {
      const info = g.infos[d.info];
      const all = instanceMatrices(buf, d);
      const object = new THREE.InstancedMesh(
        geometry(buf, d.mesh),
        this.looks.get(g.id, info.cls, info.cap, info.nested),
        d.count,
      );
      (object.instanceMatrix.array as Float32Array).set(all);
      object.computeBoundingSphere();
      this.add(
        node,
        new Drawable(
          this.drawables.length,
          object,
          g.id,
          info.nested,
          info.occluder,
          g.infos,
          new Uint32Array(buf, d.pl, d.count),
          { info: d.info, all, cuts: new Uint8Array(buf, d.cuts, d.count), trisEach: d.mesh.tris },
        ),
      );
    }
    for (const d of g.baked) {
      const geo = geometry(buf, d.mesh);
      const firstTri = new Uint32Array(buf, d.firstTri, d.parts),
        tris = new Uint32Array(buf, d.tris, d.parts);
      // per-vertex part index, read back by the pick pass (parts never share vertices)
      const partId = new Float32Array(d.mesh.verts),
        idx = geo.index!.array;
      for (let p = 0; p < d.parts; p++)
        for (let i = 3 * firstTri[p]; i < 3 * (firstTri[p] + tris[p]); i++) partId[idx[i]] = p;
      geo.setAttribute('partId', new THREE.BufferAttribute(partId, 1));
      const object = new THREE.Mesh(geo, this.looks.get(g.id, d.cls, d.cap, d.nested));
      this.add(
        node,
        new Drawable(
          this.drawables.length,
          object,
          g.id,
          d.nested,
          d.occluder,
          g.infos,
          new Uint32Array(buf, d.pl, d.parts),
          undefined,
          {
            firstTri,
            tris,
            info: new Uint32Array(buf, d.info, d.parts),
            origin: new Float32Array(buf, d.origin, 3 * d.parts),
            index: geo.index!,
          },
        ),
      );
    }
    node.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    this.root.add(node);
  }

  private add(node: THREE.Group, d: Drawable) {
    d.object.userData.drawable = d;
    this.drawables.push(d);
    node.add(d.object);
  }

  setTree(tree: PlacementTree) {
    this.tree = tree;
    for (const d of this.drawables) d.selection = '';
    this.refresh();
  }

  groupLabel(id: string) {
    return this.manifest.groups.find((g) => g.id === id)?.label ?? id;
  }
  isVisible(id: string) {
    return this.visible.has(id);
  }
  visibleGroups() {
    return [...this.visible];
  }
  /** replace the set of shown subsystems without refreshing; call before the panel is built */
  setVisibleGroups(ids: string[]) {
    this.visible = new Set(ids);
    this.refresh();
  }

  setVisible(id: string, on: boolean) {
    if (on) this.visible.add(id);
    else this.visible.delete(id);
    this.refresh();
  }

  setIsolation(iso: Isolation | null) {
    this.isolation = iso;
    this.refresh();
  }

  // Clipping keeps a point unless it lies on the negative side of every plane
  // (clipIntersection), so each mode removes the wedge where all planes agree.
  setCut(mode: CutMode) {
    this.cut = mode;
    const P = (x: number, y: number, z: number) => new THREE.Plane(new THREE.Vector3(x, y, z), 0);
    const planes = {
      none: [],
      half: [P(-1, 0, 0)],
      quarter: [P(-1, 0, 0), P(0, -1, 0)],
      octant: [P(-1, 0, 0), P(0, -1, 0), P(0, 0, -1)],
    }[mode];
    this.planes.splice(0, this.planes.length, ...planes);
    this.looks.setCut(mode !== 'none');
    for (const { material } of this.looks.all) material.needsUpdate = true;
    this.refresh();
  }

  // Visibility of one item (instance or part):
  //   it passes the isolation (or its subsystem is toggled on), and
  //   the cut leaves something of it (instanced items; baked parts are kept), and
  //   if nested: its enclosing solid is not drawn, or the cut opens that solid.
  refresh() {
    const iso = this.isolation,
      bit = CUT_BIT[this.cut],
      tree = this.tree;
    const isoKey = iso
      ? iso.kind === 'group'
        ? `g${iso.group}`
        : iso.kind === 'volume'
          ? `v${iso.name}`
          : `s${iso.ranges ? iso.ranges.join(',') : `${iso.from}-${iso.to}`}`
      : '';
    const box = new THREE.Box3(),
      v = new THREE.Vector3();
    let shown = 0;
    for (const d of this.drawables) {
      let on = iso?.kind === 'group' ? d.group === iso.group : iso ? true : this.visible.has(d.group);
      if (on && iso?.kind === 'volume' && d.instanced) on = d.info(0).name === iso.name;
      // whether the enclosing solid is drawn, when known per drawable
      const enclDrawn = !d.nested
        ? false
        : iso?.kind === 'group'
          ? d.occluder === iso.group
          : iso
            ? null // decided per item below
            : this.visible.has(d.occluder!);
      const key = `${on}|${bit}|${enclDrawn}|${isoKey}`;
      if (d.selection !== key) {
        d.selection = key;
        if (on) this.select(d, bit, enclDrawn, iso, tree);
        else d.object.visible = false;
      }
      if (!d.object.visible) continue;
      const n = d.instanced ? (d.object as THREE.InstancedMesh).count : d.count;
      shown += n;
      if (iso) this.expand(box, d, v);
    }
    this.shownItems = shown;
    this.bounds =
      iso && !box.isEmpty() ? box : new THREE.Box3(new THREE.Vector3(-8, -8, -11), new THREE.Vector3(8, 8, 11));
    this.onChange?.();
  }

  private select(d: Drawable, bit: number, enclDrawn: boolean | null, iso: Isolation | null, tree?: PlacementTree) {
    const inSubtree =
      iso?.kind === 'subtree'
        ? iso.ranges
          ? (p: number) => iso.ranges!.some(([a, b]) => p >= a && p < b)
          : (p: number) => p >= iso.from && p < iso.to
        : null;
    const encl = tree?.encl;
    // enclosing solid drawn? per item when isolating a subtree or a volume type
    const enclosed = (pl: number) =>
      enclDrawn !== null
        ? enclDrawn
        : !encl || encl[pl] < 0
          ? false
          : inSubtree
            ? inSubtree(encl[pl])
            : iso?.kind === 'volume'
              ? tree!.volume(encl[pl]).name === iso.name
              : false;

    if (d.instanced) {
      const { all, cuts } = d.instanced,
        mesh = d.object as THREE.InstancedMesh,
        out = mesh.instanceMatrix.array as Float32Array;
      const keep = bit < 0 ? 0 : 1 << bit,
        open = bit < 0 ? 0 : 8 << bit;
      const slots = (d.slots ??= new Uint32Array(d.count));
      let n = 0;
      for (let i = 0; i < d.count; i++) {
        const pl = d.pl[i];
        if (inSubtree && !inSubtree(pl)) continue;
        if ((cuts[i] & keep) !== keep) continue;
        if (d.nested && enclosed(pl) && !(cuts[i] & open)) continue;
        if (n !== i) out.set(all.subarray(16 * i, 16 * i + 16), 16 * n);
        slots[n++] = i;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    // baked: filter parts by rewriting the index; all parts pass in the common case
    const b = d.baked!,
      full = b.index.array;
    const pass = (p: number) => {
      const pl = d.pl[p];
      if (inSubtree && !inSubtree(pl)) return false;
      if (iso?.kind === 'volume' && d.info(p).name !== iso.name) return false;
      return !(d.nested && bit < 0 && enclosed(pl));
    };
    const kept: number[] = [];
    for (let p = 0; p < d.count; p++) if (pass(p)) kept.push(p);
    const geo = d.object.geometry;
    if (kept.length === d.count) geo.setIndex(b.index);
    else if (kept.length) {
      const idx = new Uint32Array(kept.reduce((a, p) => a + 3 * b.tris[p], 0));
      let o = 0;
      for (const p of kept) {
        const a = 3 * b.firstTri[p],
          len = 3 * b.tris[p];
        idx.set(full.subarray(a, a + len), o);
        o += len;
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    d.object.visible = kept.length > 0;
    d.object.userData.keptParts = kept.length;
  }

  private expand(box: THREE.Box3, d: Drawable, v: THREE.Vector3) {
    if (d.instanced) {
      const mesh = d.object as THREE.InstancedMesh,
        m = mesh.instanceMatrix.array,
        r = mesh.geometry.boundingSphere!;
      const rad = r.radius + r.center.length(),
        lo = box.min,
        hi = box.max;
      for (let o = 12; o < 16 * mesh.count; o += 16) {
        lo.x = Math.min(lo.x, m[o] - rad);
        hi.x = Math.max(hi.x, m[o] + rad);
        lo.y = Math.min(lo.y, m[o + 1] - rad);
        hi.y = Math.max(hi.y, m[o + 1] + rad);
        lo.z = Math.min(lo.z, m[o + 2] - rad);
        hi.z = Math.max(hi.z, m[o + 2] + rad);
      }
      return;
    }
    const geo = d.object.geometry,
      pos = geo.getAttribute('position'),
      idx = geo.index!.array;
    for (let i = 0; i < idx.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
  }

  /** number of triangles currently submitted */
  visibleTriangles() {
    let t = 0;
    for (const d of this.drawables) {
      if (!d.object.visible) continue;
      t += d.instanced
        ? d.instanced.trisEach * (d.object as THREE.InstancedMesh).count
        : d.object.geometry.index!.count / 3;
    }
    return t;
  }
}
