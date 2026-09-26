import * as THREE from 'three';
import type { Detector, Isolation } from './detector';
import type { Hit } from './picker';
import { groupStyle } from './looks';
import type { Shape } from './tree';
import { describeDetId, type DetIds } from './detids';

export interface InspectorActions {
  isolate(iso: Isolation): void;
  frame(sphere: THREE.Sphere): void;
}

const ACCENT = new THREE.Color('#ffd166');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = (x: number, d = 2) => x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

// TGeo shape parameters are in cm and degrees; show lengths in mm.
function describeShape(s: Shape) {
  const mm = (cm: unknown) => `${fmt(Number(cm) * 10, 1)} mm`;
  const deg = (x: unknown) => `${fmt(Number(x), 1)}°`;
  const rows: [string, string][] = [['Type', s.type.replace('TGeo', '')]];
  const has = (...k: string[]) => k.every((x) => s[x] !== undefined);
  if (has('rmin', 'rmax')) rows.push(['Radius', `${mm(s.rmin)} – ${mm(s.rmax)}`]);
  if (has('rmin1', 'rmax1', 'rmin2', 'rmax2'))
    rows.push(['Radius', `${mm(s.rmin1)}–${mm(s.rmax1)} → ${mm(s.rmin2)}–${mm(s.rmax2)}`]);
  if (has('phi1', 'phi2')) rows.push(['φ range', `${deg(s.phi1)} – ${deg(s.phi2)}`]);
  if (has('phi1', 'dphi')) rows.push(['φ range', `${deg(s.phi1)} + ${deg(s.dphi)}`]);
  if (has('nedges')) rows.push(['Polygon', `${s.nedges} sides, ${s.nz} planes`]);
  else if (has('nz')) rows.push(['Planes', String(s.nz)]);
  if (has('nvert')) rows.push(['Outline', `${s.nvert} vertices`]);
  if (has('op'))
    rows.push(['Boolean', `${s.op} of ${String(s.left).replace('TGeo', '')}, ${String(s.right).replace('TGeo', '')}`]);
  rows.push(['Extent', `${mm(2 * s.dx)} × ${mm(2 * s.dy)} × ${mm(2 * s.dz)}`]);
  return rows;
}

export class Inspector {
  readonly highlight = new THREE.Group();
  selection: Hit | null = null;
  detIds?: DetIds;
  private card = document.getElementById('inspector')!;
  private surface: THREE.MeshStandardMaterial;
  private xray: THREE.MeshBasicMaterial;

  constructor(
    private det: Detector,
    private actions: InspectorActions,
  ) {
    this.surface = new THREE.MeshStandardMaterial({
      color: ACCENT,
      emissive: ACCENT,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0,
      clippingPlanes: det.planes,
      clipIntersection: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.xray = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.22,
      depthTest: false,
      depthWrite: false,
      clippingPlanes: det.planes,
      clipIntersection: true,
    });
    this.highlight.renderOrder = 10;
  }

  select(hit: Hit | null) {
    this.selection = hit;
    this.highlight.clear();
    if (!hit) {
      this.card.replaceChildren();
      this.card.classList.remove('open');
      return;
    }
    const { drawable: d, item } = hit,
      geo = d.itemGeometry(item),
      matrix = d.matrix(item);
    for (const [material, order] of [
      [this.surface, 11],
      [this.xray, 12],
    ] as const) {
      const m = new THREE.Mesh(geo, material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(matrix);
      m.renderOrder = order;
      this.highlight.add(m);
    }
    this.syncSide();
    this.render();
  }

  /** caps are double-sided while cut open; the highlight must follow */
  syncSide() {
    const side = this.selection ? (this.selection.drawable.object.material as THREE.Material).side : THREE.FrontSide;
    for (const m of [this.surface, this.xray])
      if (m.side !== side) {
        m.side = side;
        m.needsUpdate = true;
      }
  }

  frameSelection() {
    if (this.selection) this.actions.frame(this.selection.drawable.itemSphere(this.selection.item));
  }

  render() {
    const hit = this.selection;
    if (!hit) return;
    const { drawable: d, item } = hit,
      info = d.info(item),
      tree = this.det.tree,
      pl = d.pl[item];
    const style = groupStyle(d.group);

    const head = el('div', 'head');
    const sw = el('span', 'swatch');
    sw.style.background = style.color;
    const close = el('button', 'close', '×');
    close.title = 'Clear selection (Esc)';
    close.onclick = () => this.select(null);
    head.append(sw, el('span', 'group', this.det.groupLabel(d.group)), close);

    const title = el('h2', 'name', tree ? tree.name(pl) : info.name);

    const rows: [string, string][] = [];
    rows.push(['Material', `${info.material.split(':').pop()}, ${fmt(info.density)} g/cm³`]);
    const o = d.origin(item),
      r = Math.hypot(o.x, o.y),
      theta = Math.atan2(r, o.z);
    rows.push(['Position', `${fmt(o.x)}, ${fmt(o.y)}, ${fmt(o.z)} m`]);
    rows.push(['r', `${fmt(r)} m`], ['z', `${fmt(o.z)} m`]);
    rows.push(['η', fmt(-Math.log(Math.tan(theta / 2)))], ['φ', `${fmt((Math.atan2(o.y, o.x) * 180) / Math.PI, 1)}°`]);
    const sphere = d.itemSphere(item),
      match = this.detIds?.nearest(sphere.center, 0.5 * sphere.radius + 0.02);
    if (match) {
      const { detector, subdetector } = describeDetId(match.id);
      rows.push(
        ['DetId', `${match.id} (0x${match.id.toString(16)})`],
        ['Reco', `${detector}, ${subdetector}`],
        ['Match', `nearest by position, ${fmt(match.distance * 1000, 1)} mm off`],
      );
    }
    if (tree) {
      rows.push(...describeShape(tree.volume(pl).shape));
      rows.push(['Copies', `${tree.copiesOf(pl).toLocaleString()} placements of this volume`]);
    }
    const table = el('dl');
    for (const [k, v] of rows) table.append(el('dt', undefined, k), el('dd', undefined, v));

    const acts = el('div', 'actions');
    const act = (label: string, title: string, fn: () => void) => {
      const b = el('button', undefined, label);
      b.title = title;
      b.onclick = fn;
      acts.append(b);
    };
    act('Frame', 'Zoom to this part (F, or double-click)', () => this.frameSelection());
    if (tree)
      act('Isolate part', 'Show only this placement and its contents', () =>
        this.actions.isolate({ kind: 'subtree', from: pl, to: tree.end(pl), label: tree.name(pl) }),
      );
    act('Isolate volume', 'Show every placement of this volume', () =>
      this.actions.isolate({ kind: 'volume', name: info.name, label: `${info.name} (all copies)` }),
    );
    act('Isolate subsystem', 'Show only this subsystem', () =>
      this.actions.isolate({ kind: 'group', group: d.group, label: this.det.groupLabel(d.group) }),
    );

    const parts: HTMLElement[] = [head, title, table, acts];
    if (tree) {
      const path = el('ol', 'path');
      for (const p of tree.path(pl)) {
        const li = el('li', tree.isSolid(p) ? 'solid' : 'gas');
        li.append(el('span', undefined, tree.name(p)));
        li.style.paddingLeft = `${tree.depth[p] * 8}px`;
        li.title = 'Isolate this assembly';
        li.onclick = () => this.actions.isolate({ kind: 'subtree', from: p, to: tree.end(p), label: tree.name(p) });
        path.append(li);
      }
      parts.push(el('h3', undefined, 'Placement path'), path);
    } else parts.push(el('div', 'hint loading', 'Loading placement tree'));

    this.card.replaceChildren(...parts);
    this.card.classList.add('open');
  }
}
