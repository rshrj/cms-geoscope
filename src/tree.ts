import { DataSource } from './data';

// Full TGeo placement hierarchy written by tools/convert.mjs: every node in depth-first
// preorder, so a node's subtree is the contiguous range [pl, end(pl)).

export interface Shape {
  type: string;
  dx: number;
  dy: number;
  dz: number;
  [param: string]: number | string;
}
export interface Volume {
  name: string;
  material: string | null;
  density: number;
  shape: Shape;
}

interface TreeJson {
  count: number;
  vol: number;
  copy: number;
  depth: number;
  gasDensity: number;
  volumes: Volume[];
}

export class PlacementTree {
  readonly count: number;
  readonly volumes: Volume[];
  readonly vol: Uint16Array;
  readonly copy: Uint32Array;
  readonly depth: Uint8Array;
  readonly parent: Int32Array;
  /** nearest ancestor made of solid (drawn) material, or -1 */
  readonly encl: Int32Array;
  private readonly solidVol: Uint8Array;
  private placementsOf?: Uint32Array;

  static async load(base: string) {
    const src = DataSource.for(base);
    const [json, buf] = await Promise.all([src.json<TreeJson>('tree.json'), src.buffer('tree.bin')]);
    return new PlacementTree(json, buf);
  }

  private constructor(j: TreeJson, buf: ArrayBuffer) {
    this.count = j.count;
    this.volumes = j.volumes;
    this.vol = new Uint16Array(buf, j.vol, j.count);
    this.copy = new Uint32Array(buf, j.copy, j.count);
    this.depth = new Uint8Array(buf, j.depth, j.count);
    this.solidVol = Uint8Array.from(j.volumes, (v) => +(v.density >= j.gasDensity));
    this.parent = new Int32Array(j.count);
    this.encl = new Int32Array(j.count);
    const stack: number[] = [];
    for (let i = 0; i < j.count; i++) {
      const d = this.depth[i],
        p = d ? stack[d - 1] : -1;
      stack[d] = i;
      this.parent[i] = p;
      this.encl[i] = p < 0 ? -1 : this.isSolid(p) ? p : this.encl[p];
    }
  }

  isSolid(pl: number) {
    return this.solidVol[this.vol[pl]] === 1;
  }
  volume(pl: number) {
    return this.volumes[this.vol[pl]];
  }
  name(pl: number) {
    return `${this.volume(pl).name}_${this.copy[pl]}`;
  }

  path(pl: number) {
    const out: number[] = [];
    for (let p = pl; p >= 0; p = this.parent[p]) out.push(p);
    return out.reverse();
  }

  end(pl: number) {
    const d = this.depth[pl];
    let j = pl + 1;
    while (j < this.count && this.depth[j] > d) j++;
    return j;
  }

  /** number of placements of the volume placed at pl, anywhere in the detector */
  copiesOf(pl: number) {
    if (!this.placementsOf) {
      this.placementsOf = new Uint32Array(this.volumes.length);
      for (let i = 0; i < this.count; i++) this.placementsOf[this.vol[i]]++;
    }
    return this.placementsOf[this.vol[pl]];
  }
}
