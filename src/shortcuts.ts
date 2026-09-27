import { VIEWS } from './ui';

export interface Shortcut {
  keys: string[];
  action: string;
}
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** Everything the viewer responds to, for the help overlay. Keep in step with input.ts and search.ts. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Camera',
    items: [
      { keys: ['Drag'], action: 'Orbit' },
      { keys: ['Right-drag'], action: 'Pan' },
      { keys: ['Scroll'], action: 'Zoom to the cursor' },
      ...VIEWS.map((v, i) => ({ keys: [String(i + 1)], action: `${v} view` })),
      { keys: ['R'], action: 'Reset to the overview' },
    ],
  },
  {
    title: 'Parts',
    items: [
      { keys: ['Click'], action: 'Select a part' },
      { keys: ['Double-click', 'F'], action: 'Frame the selection' },
      { keys: ['Esc'], action: 'Leave measuring, then clear the selection, then leave isolation' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { keys: ['/'], action: 'Search volumes' },
      { keys: ['M'], action: 'Measure between two points' },
      { keys: ['C'], action: 'Clear measurements' },
      { keys: ['?'], action: 'Show or hide this help' },
    ],
  },
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The overlay: `?` toggles it, Esc or a click outside closes it. */
export function createShortcutHelp() {
  const overlay = el('div', 'shortcuts');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Keyboard shortcuts');
  const card = el('div', 'card');
  const head = el('div', 'head');
  const close = el('button', 'close', '×');
  close.title = 'Close (Esc)';
  head.append(el('h2', undefined, 'Keyboard shortcuts'), close);
  card.append(head);
  for (const g of SHORTCUTS) {
    card.append(el('h3', undefined, g.title));
    const dl = el('dl');
    for (const s of g.items) {
      const dt = el('dt');
      s.keys.forEach((k, i) => {
        if (i) dt.append(' or ');
        dt.append(el('kbd', undefined, k));
      });
      dl.append(dt, el('dd', undefined, s.action));
    }
    card.append(dl);
  }
  overlay.append(card);
  document.body.append(overlay);

  const isOpen = () => overlay.classList.contains('open');
  const setOpen = (on: boolean) => overlay.classList.toggle('open', on);
  close.onclick = () => setOpen(false);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) setOpen(false);
  });
  // capture phase, so Esc closes the help before the viewer's own Esc handling sees it
  addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
        e.stopImmediatePropagation();
      } else if (e.key === '?' && !(e.target instanceof HTMLInputElement)) {
        setOpen(!isOpen());
        e.preventDefault();
      }
    },
    true,
  );
  return {
    toggle: () => setOpen(!isOpen()),
    get isOpen() {
      return isOpen();
    },
  };
}
