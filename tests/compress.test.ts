import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from '../src/data';
import { compressDirectory, verifyDirectory } from '../tools/compress.mjs';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geoscope-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const big = Buffer.from('CMS '.repeat(50_000)); // compresses well
const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) & 255));

async function seed() {
  await writeFile(join(dir, 'big.bin'), big);
  await writeFile(join(dir, 'noise.bin'), noise);
  await writeFile(join(dir, 'm.json'), JSON.stringify({ a: [1, 2, 3] }));
}

describe('compressDirectory', () => {
  it('replaces each file with a .gz and writes an index', async () => {
    await seed();
    const { skipped, files } = await compressDirectory(dir);
    expect(skipped).toBe(false);
    expect((await readdir(dir)).sort()).toEqual(['big.bin.gz', 'compressed.json', 'm.json.gz', 'noise.bin.gz']);
    expect(files['big.bin'].size).toBe(big.length);
    expect(files['big.bin'].stored).toBeLessThan(big.length / 10);
    const index = JSON.parse(await readFile(join(dir, 'compressed.json'), 'utf8'));
    expect(Object.keys(index.files).sort()).toEqual(['big.bin', 'm.json', 'noise.bin']);
    expect(index.encoding).toBe('gzip');
  });

  it('is idempotent', async () => {
    await seed();
    await compressDirectory(dir);
    const before = await readdir(dir);
    expect((await compressDirectory(dir)).skipped).toBe(true);
    expect(await readdir(dir)).toEqual(before);
  });

  it('leaves subdirectories alone', async () => {
    await seed();
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'x.bin'), 'x');
    await compressDirectory(dir);
    expect(await readdir(join(dir, 'sub'))).toEqual(['x.bin']);
  });

  it('handles an empty directory', async () => {
    const { files } = await compressDirectory(dir);
    expect(files).toEqual({});
  });

  it('throws for a missing directory', async () => {
    await expect(compressDirectory(join(dir, 'nope'))).rejects.toThrow(/No such directory/);
  });

  it('produces files the viewer loader reads back byte for byte', async () => {
    await seed();
    await compressDirectory(dir);
    const fetchFn = (async (url: string) => {
      try {
        return new Response(await readFile(join(dir, url.replace(/^data\//, ''))));
      } catch {
        return new Response('missing', { status: 404 });
      }
    }) as unknown as typeof fetch;
    const src = new DataSource('data', fetchFn);
    expect(Buffer.from(await src.buffer('big.bin')).equals(big)).toBe(true);
    expect(Buffer.from(await src.buffer('noise.bin')).equals(noise)).toBe(true);
    expect(await src.json('m.json')).toEqual({ a: [1, 2, 3] });
  });
});

describe('verifyDirectory', () => {
  it('passes for a freshly compressed directory', async () => {
    await seed();
    await compressDirectory(dir);
    expect(await verifyDirectory(dir)).toEqual([]);
  });

  it('reports a missing index', async () => {
    expect((await verifyDirectory(dir))[0]).toMatch(/compressed\.json/);
  });

  it('reports a missing .gz file', async () => {
    await seed();
    await compressDirectory(dir);
    await rm(join(dir, 'big.bin.gz'));
    expect((await verifyDirectory(dir)).join('\n')).toMatch(/big\.bin/);
  });

  it('reports a corrupted .gz file', async () => {
    await seed();
    await compressDirectory(dir);
    const p = join(dir, 'noise.bin.gz'),
      data = await readFile(p);
    data[data.length - 20] ^= 0xff;
    await writeFile(p, data);
    expect((await verifyDirectory(dir)).join('\n')).toMatch(/noise\.bin/);
  });

  it('reports a checksum that does not match the index', async () => {
    await seed();
    await compressDirectory(dir);
    const p = join(dir, 'compressed.json'),
      index = JSON.parse(await readFile(p, 'utf8'));
    index.files['m.json'].sha256 = '0'.repeat(64);
    await writeFile(p, JSON.stringify(index));
    expect((await verifyDirectory(dir)).join('\n')).toMatch(/m\.json: checksum mismatch/);
  });
});
