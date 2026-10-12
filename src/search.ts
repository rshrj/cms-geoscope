import { describeDetId, parseDetId, type DetIds } from './detids';
import type { PlacementTree } from './tree';

// Fuzzy search over volume names: every space-separated token must match, either as a
// substring (best, more so at the start or a word boundary) or as a scattered subsequence.
// A number (decimal or 0x hex) is looked up as a DetId instead.

interface Entry {
  name: string;
  lower: string;
  material: string;
  solid: boolean;
}

interface Row {
  label: string;
  note: string;
  /** absent for rows that only inform; returning false keeps the search open */
  pick?: () => boolean | void;
}

export function score(lower: string, token: string): number {
  const at = lower.indexOf(token);
  if (at >= 0) {
    const boundary = at === 0 || /[^a-z0-9]/.test(lower[at - 1]);
    return 100 - Math.min(at, 40) + (boundary ? 30 : 0) - Math.min(lower.length - token.length, 40) * 0.3;
  }
  let i = 0,
    gaps = 0,
    last = -1;
  for (const ch of token) {
    i = lower.indexOf(ch, i);
    if (i < 0) return -1;
    if (last >= 0 && i > last + 1) gaps++;
    last = i++;
  }
  return 40 - gaps * 4 - Math.min(lower.length - token.length, 40) * 0.2;
}

export function aliases(name: string) {
  const n = name.split(':').pop()!;
  const disc = /^ITDisc(\d+)(Ring\d+)?$/.exec(n);
  const ot = /^OTLayer(\d)$/.exec(n);
  if (n === 'Phase2PixelBarrel' || /^ITLayer\d$/.test(n)) return 'tbpx bpix';
  if (disc) return +disc[1] <= 8 ? 'tfpx fpix' : 'tepx fpix';
  if (n === 'Phase2OTBarrel') return 'tbps tb2s';
  if (ot) return +ot[1] <= 3 ? 'tbps' : 'tb2s';
  return '';
}

export class Search {
  private entries: Entry[] = [];
  private input = document.createElement('input');
  private list = document.createElement('ul');
  private results: Row[] = [];
  private active = 0;
  private detIds?: DetIds;

  constructor(
    host: HTMLElement,
    private onPick: (name: string, solid: boolean) => void,
    private onDetId: (id: number) => boolean,
  ) {
    const section = document.createElement('section');
    section.className = 'search loading';
    this.input.type = 'search';
    this.input.placeholder = 'Loading search…';
    this.input.disabled = true;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.list.className = 'results';
    section.append(this.input, this.list);
    host.after(section);

    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.active =
          (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % Math.max(this.results.length, 1);
        this.draw();
      } else if (e.key === 'Enter') this.pick(this.active);
      else if (e.key === 'Escape') {
        this.input.value = '';
        this.run();
        this.input.blur();
        e.stopPropagation();
      }
    });
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !this.input.disabled && document.activeElement !== this.input && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  setTree(tree: PlacementTree) {
    const seen = new Set<string>();
    for (const v of tree.volumes) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      // containers (air) are searchable too: they are the named assemblies; add the usual
      // reco/DetId names as aliases so e.g. TBPX finds the Phase-2 pixel barrel
      this.entries.push({
        name: v.name,
        lower: `${v.name.toLowerCase()} ${aliases(v.name)}`.trim(),
        material: v.density >= 0.01 ? (v.material ?? '').split(':').pop()! : 'assembly',
        solid: v.density >= 0.01,
      });
    }
    this.input.disabled = false;
    this.input.parentElement?.classList.remove('loading');
    this.input.placeholder = 'Search volumes, DetIds  ( / )';
  }

  setDetIds(ids: DetIds) {
    this.detIds = ids;
    if (this.input.value) this.run();
  }

  private detIdRow(id: number): Row {
    const label = `DetId ${id}`;
    if (!this.detIds) return { label, note: 'DetIds loading' };
    const { detector, subdetector } = describeDetId(id);
    if (!this.detIds.centre(id))
      return { label, note: detector === 'HGCAL' ? 'HGCAL cells are not listed' : 'not in this geometry' };
    return { label, note: subdetector, pick: () => this.onDetId(id) };
  }

  private run() {
    const id = parseDetId(this.input.value);
    if (id !== null) {
      this.results = [this.detIdRow(id)];
      this.active = 0;
      return this.draw();
    }
    const tokens = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: [number, Entry][] = [];
    if (tokens.length)
      for (const e of this.entries) {
        let total = 0;
        for (const t of tokens) {
          const s = score(e.lower, t);
          if (s < 0) {
            total = -1;
            break;
          }
          total += s;
        }
        if (total >= 0) scored.push([total, e]);
      }
    scored.sort((a, b) => b[0] - a[0]);
    this.results = scored.slice(0, 12).map(([, e]) => ({
      label: e.name,
      note: e.material,
      pick: () => this.onPick(e.name, e.solid),
    }));
    this.active = 0;
    this.draw();
  }

  private draw() {
    this.list.replaceChildren(
      ...this.results.map((r, i) => {
        const li = document.createElement('li');
        li.classList.toggle('active', i === this.active);
        li.classList.toggle('info', !r.pick);
        const n = document.createElement('span'),
          m = document.createElement('span');
        n.textContent = r.label;
        m.textContent = r.note;
        m.className = 'mat';
        li.append(n, m);
        li.onmousedown = (e) => {
          e.preventDefault();
          this.pick(i);
        };
        return li;
      }),
    );
  }

  private pick(i: number) {
    const r = this.results[i];
    if (!r?.pick) return;
    if (r.pick() === false) {
      this.results[i] = { label: r.label, note: 'no part at its position' };
      return this.draw();
    }
    this.input.value = '';
    this.run();
    this.input.blur();
  }
}
