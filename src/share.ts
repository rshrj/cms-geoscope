import type { CutMode, Isolation } from './detector';

// The whole view lives in the URL hash, e.g.
//   #cam=1.2,3,4.5,0,0,0&cut=quarter&on=ecal,hgcal&iso=g:hgcal&q=fast&m=1,2,3,4,5,6
// so any link reproduces it, and the address bar stays current as you move around.

export interface ViewState {
  cam?: number[]; // position xyz, target xyz (m)
  cut?: CutMode;
  on?: string[]; // visible subsystems
  iso?: Isolation | null;
  quality?: string;
  measurements?: number[][]; // each: ax ay az bx by bz
}

const num = (x: number) => String(+x.toFixed(3));

export function encode(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.cam) p.set('cam', s.cam.map(num).join(','));
  if (s.cut) p.set('cut', s.cut);
  if (s.on) p.set('on', s.on.join(','));
  const i = s.iso;
  if (i)
    p.set(
      'iso',
      i.kind === 'group'
        ? `g:${i.group}`
        : i.kind === 'volume'
          ? `v:${i.name}`
          : `s:${(i.ranges ?? [[i.from, i.to]]).map((r) => r.join('-')).join(';')}~${i.label}`,
    );
  if (s.quality && s.quality !== 'high') p.set('q', s.quality);
  if (s.measurements?.length) p.set('m', s.measurements.map((m) => m.map(num).join(',')).join(';'));
  return p.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%3B/gi, ';');
}

export function decode(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, '')),
    s: ViewState = {};
  const nums = (v: string) => v.split(',').map(Number);
  const cam = p.get('cam');
  if (cam) {
    const c = nums(cam);
    if (c.length === 6 && c.every(Number.isFinite)) s.cam = c;
  }
  const cut = p.get('cut');
  if (cut === 'none' || cut === 'quarter' || cut === 'half' || cut === 'octant') s.cut = cut;
  if (p.has('on')) s.on = p.get('on')!.split(',').filter(Boolean);
  const iso = p.get('iso');
  if (iso?.startsWith('g:')) s.iso = { kind: 'group', group: iso.slice(2), label: iso.slice(2) };
  else if (iso?.startsWith('v:')) s.iso = { kind: 'volume', name: iso.slice(2), label: `${iso.slice(2)} (all copies)` };
  else if (iso?.startsWith('s:')) {
    const [r, ...label] = iso.slice(2).split('~');
    const ranges = r
      .split(';')
      .map((x) => x.split('-').map(Number) as [number, number])
      .filter((x) => x.length === 2 && x.every(Number.isFinite));
    if (ranges.length)
      s.iso = {
        kind: 'subtree',
        from: ranges[0][0],
        to: ranges[0][1],
        ranges,
        label: label.join('~') || 'Shared selection',
      };
  }
  if (p.has('q')) s.quality = p.get('q')!;
  const m = p.get('m');
  if (m)
    s.measurements = m
      .split(';')
      .map(nums)
      .filter((a) => a.length === 6 && a.every(Number.isFinite));
  return s;
}
