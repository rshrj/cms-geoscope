import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DataSource, parseIndex } from '../src/data';

const bytes = (s: string) => new TextEncoder().encode(s);
const sha = 'x'.repeat(64);

/** a fake server: path -> body (Uint8Array | string) served with 200, everything else 404 */
function server(files: Record<string, Uint8Array | string>) {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    const body = files[url];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body as BodyInit);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const index = (files: Record<string, { size: number; stored: number }>) =>
  JSON.stringify({
    encoding: 'gzip',
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { ...v, sha256: sha }])),
  });

describe('parseIndex', () => {
  it('accepts a well-formed index', () => {
    const i = parseIndex({ encoding: 'gzip', files: { 'a.bin': { size: 3, stored: 2, sha256: sha } } });
    expect(i?.files['a.bin'].size).toBe(3);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['the wrong encoding', { encoding: 'br', files: {} }],
    ['missing files', { encoding: 'gzip' }],
    ['a file that is not an object', { encoding: 'gzip', files: { a: 1 } }],
    ['a negative size', { encoding: 'gzip', files: { a: { size: -1, stored: 1, sha256: sha } } }],
    ['a fractional size', { encoding: 'gzip', files: { a: { size: 1.5, stored: 1, sha256: sha } } }],
    ['a missing checksum', { encoding: 'gzip', files: { a: { size: 1, stored: 1 } } }],
  ])('rejects %s', (_, x) => {
    expect(parseIndex(x)).toBeNull();
  });
});

describe('DataSource', () => {
  const raw = bytes('hello geometry, hello geometry, hello geometry');
  const packed = new Uint8Array(gzipSync(raw));
  const idx = index({ 'a.bin': { size: raw.length, stored: packed.length } });

  it('decompresses files listed in the index', async () => {
    const { fetchFn, calls } = server({ 'data/compressed.json': idx, 'data/a.bin.gz': packed });
    const buf = await new DataSource('data', fetchFn).buffer('a.bin');
    expect(new Uint8Array(buf)).toEqual(raw);
    expect(calls).toContain('data/a.bin.gz');
    expect(calls).not.toContain('data/a.bin');
  });

  it('accepts a body the server or browser already decompressed', async () => {
    const { fetchFn } = server({ 'data/compressed.json': idx, 'data/a.bin.gz': raw });
    expect(new Uint8Array(await new DataSource('data', fetchFn).buffer('a.bin'))).toEqual(raw);
  });

  it('still checks the size of an already decompressed body', async () => {
    const { fetchFn } = server({ 'data/compressed.json': idx, 'data/a.bin.gz': raw.slice(0, 10) });
    await expect(new DataSource('data', fetchFn).buffer('a.bin')).rejects.toThrow(/corrupt/);
  });

  it('parses JSON files', async () => {
    const json = bytes('{"n":42}'),
      gz = new Uint8Array(gzipSync(json));
    const { fetchFn } = server({
      'data/compressed.json': index({ 'm.json': { size: json.length, stored: gz.length } }),
      'data/m.json.gz': gz,
    });
    expect(await new DataSource('data', fetchFn).json<{ n: number }>('m.json')).toEqual({ n: 42 });
  });

  it('reads raw files when there is no index (dev server)', async () => {
    const { fetchFn } = server({ 'data/a.bin': raw });
    expect(new Uint8Array(await new DataSource('data', fetchFn).buffer('a.bin'))).toEqual(raw);
  });

  it('treats an HTML fallback page at the index path as no index', async () => {
    const { fetchFn } = server({ 'data/compressed.json': '<!doctype html><html></html>', 'data/a.bin': raw });
    expect(new Uint8Array(await new DataSource('data', fetchFn).buffer('a.bin'))).toEqual(raw);
  });

  it('reads a raw file that the index does not list', async () => {
    const { fetchFn } = server({ 'data/compressed.json': idx, 'data/other.bin': raw });
    expect(new Uint8Array(await new DataSource('data', fetchFn).buffer('other.bin'))).toEqual(raw);
  });

  it('fetches the index only once', async () => {
    const { fetchFn, calls } = server({ 'data/compressed.json': idx, 'data/a.bin.gz': packed });
    const src = new DataSource('data', fetchFn);
    await Promise.all([src.buffer('a.bin'), src.buffer('a.bin'), src.buffer('a.bin')]);
    expect(calls.filter((c) => c.endsWith('compressed.json'))).toHaveLength(1);
  });

  it('fails clearly when the size does not match the index', async () => {
    const { fetchFn } = server({
      'data/compressed.json': index({ 'a.bin': { size: raw.length + 1, stored: packed.length } }),
      'data/a.bin.gz': packed,
    });
    await expect(new DataSource('data', fetchFn).buffer('a.bin')).rejects.toThrow(/corrupt.*expected/);
  });

  it('fails on truncated or corrupt gzip data', async () => {
    const { fetchFn } = server({ 'data/compressed.json': idx, 'data/a.bin.gz': packed.slice(0, packed.length - 6) });
    await expect(new DataSource('data', fetchFn).buffer('a.bin')).rejects.toThrow();
  });

  it('fails clearly when a listed file is missing', async () => {
    const { fetchFn } = server({ 'data/compressed.json': idx });
    await expect(new DataSource('data', fetchFn).buffer('a.bin')).rejects.toThrow(/a\.bin\.gz.*404/);
  });

  it('fails clearly when a raw file is missing', async () => {
    const { fetchFn } = server({});
    await expect(new DataSource('data', fetchFn).buffer('nope.bin')).rejects.toThrow(/nope\.bin.*404/);
  });
});
