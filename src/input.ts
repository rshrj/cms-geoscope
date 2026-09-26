import type * as THREE from 'three';
import type { Detector } from './detector';
import type { Inspector } from './inspector';
import { groupStyle } from './looks';
import type { Measure } from './measure';
import type { Picker } from './picker';
import { VIEWS } from './ui';

export interface InputContext {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  det: Detector;
  picker: Picker;
  inspector: Inspector;
  measure: Measure;
  fly(name: string): void;
  exitIsolation(): void;
}

/** Mouse and keyboard: click selects (or measures), hover names the part, keys navigate. */
export function bindInput({ canvas, camera, det, picker, inspector, measure, fly, exitIsolation }: InputContext) {
  // a click selects; a drag orbits
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) down = { x: e.offsetX, y: e.offsetY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 5 && performance.now() - down.t < 500) {
      const hit = picker.pick(camera, e.offsetX, e.offsetY);
      if (measure.active) {
        if (hit?.point) measure.add(hit.point);
      } else inspector.select(hit);
    }
    down = null;
  });
  canvas.addEventListener('dblclick', () => inspector.frameSelection());

  // hover: name the part under the cursor in a status bar (throttled; not while dragging)
  const status = document.getElementById('status')!;
  let hoverAt = 0,
    dragging = false;
  function hover(x: number, y: number) {
    const hit = picker.pick(camera, x, y);
    if (!hit) {
      status.classList.remove('on');
      return;
    }
    const { drawable: d, item } = hit,
      info = d.info(item),
      pl = d.pl[item];
    const o = d.origin(item),
      r = Math.hypot(o.x, o.y),
      f = (n: number) => n.toFixed(2);
    const sw = document.createElement('span'),
      name = document.createElement('span'),
      meta = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = groupStyle(d.group).color;
    name.className = 'name';
    name.textContent = det.tree ? det.tree.name(pl) : info.name;
    meta.className = 'meta';
    meta.textContent = `${det.groupLabel(d.group)}, ${info.material.split(':').pop()}, r ${f(r)} m, z ${f(o.z)} m`;
    status.replaceChildren(sw, name, meta);
    status.classList.add('on');
  }
  canvas.addEventListener('pointerdown', () => {
    dragging = true;
    status.classList.remove('on');
  });
  addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointerleave', () => status.classList.remove('on'));
  canvas.addEventListener('pointermove', (e) => {
    if (dragging || e.buttons) return;
    const now = performance.now();
    if (now - hoverAt < 80) return;
    hoverAt = now;
    hover(e.offsetX, e.offsetY);
  });

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const i = Number(e.key) - 1;
    if (VIEWS[i]) fly(VIEWS[i]);
    else if (e.key === 'Escape') {
      if (measure.active) measure.setActive(false);
      else if (inspector.selection) inspector.select(null);
      else if (det.isolation) exitIsolation();
    } else if (e.key === 'r' || e.key === 'R') fly('Overview');
    else if (e.key === 'm' || e.key === 'M') measure.setActive(!measure.active);
    else if (e.key === 'c' || e.key === 'C') measure.clear();
    else if (e.key === 'f' || e.key === 'F') inspector.frameSelection();
  });
}
