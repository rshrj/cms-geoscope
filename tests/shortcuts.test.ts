import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../src/shortcuts';
import { VIEWS } from '../src/ui';

const all = SHORTCUTS.flatMap((g) => g.items);
const keys = all.flatMap((s) => s.keys);

describe('shortcut list', () => {
  it('has a description for every entry', () => {
    for (const s of all) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.action.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('lists each key once', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has one number key per camera view, named after the view', () => {
    VIEWS.forEach((v, i) => {
      expect(all.find((s) => s.keys[0] === String(i + 1))?.action).toBe(`${v} view`);
    });
  });
});

describe('shortcut list against the code', () => {
  const input = readFileSync('src/input.ts', 'utf8');
  const search = readFileSync('src/search.ts', 'utf8');

  it.each(['R', 'M', 'C', 'F'])('input.ts handles %s', (k) => {
    expect(input).toContain(`'${k.toLowerCase()}'`);
    expect(keys).toContain(k);
  });

  it('input.ts handles Escape, and search.ts handles /', () => {
    expect(input).toContain("'Escape'");
    expect(keys).toContain('Esc');
    expect(search).toContain("'/'");
    expect(keys).toContain('/');
  });
});
