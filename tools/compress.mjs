// Gzips every file in a data directory (default dist/data) in place and writes
// compressed.json, which tells the viewer (src/data.ts) which files are stored compressed.
//
//   node tools/compress.mjs [dir]          compress (does nothing if already compressed)
//   node tools/compress.mjs --verify [dir] check every .gz against the index
import { createHash } from 'node:crypto';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const INDEX = 'compressed.json';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const exists = (p) =>
  readFile(p).then(
    () => true,
    () => false,
  );

/** Compress each regular file in `dir`. Each result is decompressed and compared before the original is removed. */
export async function compressDirectory(dir, { level = 9 } = {}) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(`No such directory: ${dir}`);
  }
  if (await exists(join(dir, INDEX))) return { skipped: true, files: {} };

  const files = {};
  for (const e of entries
    .filter((e) => e.isFile() && !e.name.endsWith('.gz'))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const raw = await readFile(join(dir, e.name));
    const packed = await gzipAsync(raw, { level });
    if (sha256(await gunzipAsync(packed)) !== sha256(raw)) throw new Error(`Round trip failed for ${e.name}`);
    await writeFile(join(dir, `${e.name}.gz`), packed);
    await unlink(join(dir, e.name));
    files[e.name] = { size: raw.length, stored: packed.length, sha256: sha256(raw) };
  }
  await writeFile(join(dir, INDEX), JSON.stringify({ encoding: 'gzip', files }, null, 1));
  return { skipped: false, files };
}

/** Returns a list of problems; empty means every file matches the index. */
export async function verifyDirectory(dir) {
  const problems = [];
  let index;
  try {
    index = JSON.parse(await readFile(join(dir, INDEX), 'utf8'));
  } catch {
    return [`${INDEX} is missing or unreadable in ${dir}`];
  }
  for (const [name, f] of Object.entries(index.files ?? {})) {
    try {
      const raw = await gunzipAsync(await readFile(join(dir, `${name}.gz`)));
      if (raw.length !== f.size) problems.push(`${name}: size ${raw.length}, expected ${f.size}`);
      else if (sha256(raw) !== f.sha256) problems.push(`${name}: checksum mismatch`);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  }
  return problems;
}

const mb = (n) => (n / 1e6).toFixed(1);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const dir = args.find((a) => !a.startsWith('--')) ?? 'dist/data';
  try {
    if (verify) {
      const problems = await verifyDirectory(dir);
      if (problems.length) {
        console.error(problems.join('\n'));
        process.exit(1);
      }
      console.log(`${dir}: all files match ${INDEX}`);
    } else {
      if (
        !(await readdir(dir).then(
          () => true,
          () => false,
        ))
      ) {
        console.log(`${dir}: not found, nothing to compress`); // e.g. CI builds without data
        process.exit(0);
      }
      const { skipped, files } = await compressDirectory(dir);
      const list = Object.values(files);
      if (skipped) console.log(`${dir}: already compressed`);
      else if (!list.length) console.log(`${dir}: no files to compress`);
      else {
        const size = list.reduce((a, f) => a + f.size, 0),
          stored = list.reduce((a, f) => a + f.stored, 0);
        console.log(`${dir}: ${list.length} files, ${mb(size)} MB -> ${mb(stored)} MB`);
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
