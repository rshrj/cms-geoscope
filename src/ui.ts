import type { CutMode, Detector, Isolation } from './detector';
import { CATEGORIES, groupStyle } from './looks';

export interface UiHandlers {
  onCut(mode: CutMode): void;
  onView(name: string): void;
  onScreenshot(): void;
  onSolo(group: string): void;
  onQuality(q: string): void;
  onMeasure(b: HTMLElement): void;
  onShare(b: HTMLElement): void;
  onHelp(): void;
  quality?: string;
}

export const VIEWS = ['Overview', 'Side', 'End-on', 'Tracker', 'Endcap'];
const CUTS: [CutMode, string][] = [
  ['none', 'Closed'],
  ['quarter', 'Quarter'],
  ['half', 'Half'],
  ['octant', 'Octant'],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function buildPanel(det: Detector, h: UiHandlers) {
  const panel = document.getElementById('panel')!;
  const m = det.manifest;
  const meta = m.source.replace(/^cmsSimGeom-|\.root$/g, '');

  const head = el('header');
  head.append(
    el('div', 'eyebrow', 'CMS Phase-2'),
    el('h1', undefined, 'Detector geometry'),
    el('div', 'meta', `${meta}, simulation geometry`),
  );

  const segmented = <T extends string>(items: [T, string][], initial: T, on: (v: T) => void) => {
    const row = el('div', 'segmented');
    for (const [value, label] of items) {
      const b = el('button', value === initial ? 'on' : '', label);
      b.onclick = () => {
        row.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        on(value);
      };
      row.append(b);
    }
    return row;
  };

  const cut = el('section');
  cut.append(el('h2', undefined, 'Cutaway'), segmented(CUTS, det.cut, h.onCut));

  const QUALITY: [string, string][] = [
    ['high', 'Full'],
    ['balanced', 'Balanced'],
    ['fast', 'Fast'],
  ];
  const quality = el('section');
  const qrow = segmented(QUALITY, h.quality ?? 'high', h.onQuality);
  qrow.style.gridTemplateColumns = 'repeat(3, 1fr)';
  quality.append(el('h2', undefined, 'Detail'), qrow);

  const views = el('section');
  const vrow = el('div', 'chips');
  VIEWS.forEach((v, i) => {
    const b = el('button', undefined, v);
    b.title = `Key ${i + 1}`;
    b.onclick = () => h.onView(v);
    vrow.append(b);
  });
  const reset = el('button', undefined, 'Reset view');
  reset.title = 'Back to the overview (R)';
  reset.onclick = () => h.onView('Overview');
  const measureBtn = el('button', undefined, 'Measure');
  measureBtn.title = 'Click two points to measure (M); clear with C';
  h.onMeasure(measureBtn);
  vrow.append(reset, measureBtn);
  views.append(el('h2', undefined, 'Views'), vrow);

  const boxes = new Map<string, HTMLInputElement>();
  const groups = el('section', 'groups');
  groups.append(el('h2', undefined, 'Subsystems'));
  for (const cat of CATEGORIES) {
    const members = m.groups.filter((g) => groupStyle(g.id).category === cat);
    if (!members.length) continue;
    groups.append(el('h3', undefined, cat));
    for (const g of members) {
      const row = el('label', 'group');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = det.isVisible(g.id);
      boxes.set(g.id, box);
      box.onchange = () => det.setVisible(g.id, box.checked);
      const sw = el('span', 'swatch');
      sw.style.background = groupStyle(g.id).color;
      const solo = el('button', 'solo', 'only');
      solo.title = `Show only ${g.label}`;
      solo.onclick = (e) => {
        e.preventDefault();
        for (const [id, box] of boxes) {
          box.checked = id === g.id;
          det.setVisible(id, id === g.id);
        }
        h.onSolo(g.id);
      };
      row.append(box, sw, el('span', 'name', g.label), solo);
      groups.append(row);
    }
  }

  const foot = el('footer');
  const shot = el('button', 'ghost', 'Save PNG');
  shot.onclick = h.onScreenshot;
  const stats = el('div', 'stats');
  const share = el('button', undefined, 'Share link');
  share.title = 'Copy a link to this exact view';
  h.onShare(share);
  const btns = el('div', 'chips');
  const help = el('button', undefined, '?');
  help.title = 'Keyboard shortcuts (?)';
  help.onclick = h.onHelp;
  btns.append(share, shot, help);
  foot.append(stats, btns);

  panel.replaceChildren(head, cut, quality, views, groups, foot);
  return { stats };
}

export function showIsolation(iso: Isolation | null, items: number, onExit: () => void) {
  const banner = document.getElementById('isolation')!;
  document.getElementById('panel')!.classList.toggle('isolating', !!iso);
  if (!iso) {
    banner.classList.remove('open');
    return;
  }
  const kind = { group: 'Subsystem', volume: 'Volume', subtree: 'Assembly' }[iso.kind];
  const exit = el('button', undefined, 'Show all');
  exit.title = 'Esc';
  exit.onclick = onExit;
  banner.replaceChildren(
    el('span', 'kind', kind),
    el('span', 'label', iso.label),
    el('span', 'count', `${items.toLocaleString()} parts`),
    exit,
  );
  banner.classList.add('open');
}

export function progress(done: number, total: number, label: string) {
  const bar = document.querySelector<HTMLElement>('#loading .bar i')!;
  const text = document.querySelector<HTMLElement>('#loading .label')!;
  bar.style.width = `${(100 * done) / total}%`;
  text.textContent = label ? `Loading ${label}…` : 'Ready';
  if (done >= total) document.getElementById('loading')!.classList.add('done');
}
