// Fetches the converted geometry files. A deployed build stores them gzipped (see
// tools/compress.mjs) next to an index, compressed.json; the dev server serves them raw.
// Callers just ask for a name and get the original bytes either way.

export interface StoredFile {
  /** original size in bytes */
  size: number;
  /** size of the .gz on disk */
  stored: number;
  sha256: string;
}
export interface DataIndex {
  encoding: 'gzip';
  files: Record<string, StoredFile>;
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** the index if it is well formed, otherwise null (never throws) */
export function parseIndex(x: unknown): DataIndex | null {
  if (typeof x !== 'object' || x === null) return null;
  const { encoding, files } = x as Record<string, unknown>;
  if (encoding !== 'gzip' || typeof files !== 'object' || files === null) return null;
  const out: Record<string, StoredFile> = {};
  for (const [name, f] of Object.entries(files)) {
    if (typeof f !== 'object' || f === null) return null;
    const { size, stored, sha256 } = f as Record<string, unknown>;
    if (!isCount(size) || !isCount(stored) || typeof sha256 !== 'string') return null;
    out[name] = { size, stored, sha256 };
  }
  return { encoding, files: out };
}

const isGzip = (b: ArrayBuffer) => b.byteLength > 2 && new Uint8Array(b, 0, 2).every((v, i) => v === [0x1f, 0x8b][i]);

export class DataSource {
  private static cache = new Map<string, DataSource>();
  private index?: Promise<DataIndex | null>;

  static for(base: string) {
    let s = DataSource.cache.get(base);
    if (!s) DataSource.cache.set(base, (s = new DataSource(base)));
    return s;
  }

  constructor(
    private base: string,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private loadIndex() {
    return (this.index ??= (async () => {
      try {
        const r = await this.fetchFn(`${this.base}/compressed.json`);
        // a dev server answers unknown paths with index.html, which fails to parse: no index
        return r.ok ? parseIndex(await r.json()) : null;
      } catch {
        return null;
      }
    })());
  }

  async buffer(name: string): Promise<ArrayBuffer> {
    const entry = (await this.loadIndex())?.files[name];
    if (!entry) {
      const r = await this.fetchFn(`${this.base}/${name}`);
      if (!r.ok) throw new Error(`Could not load ${name} (HTTP ${r.status})`);
      return r.arrayBuffer();
    }
    const r = await this.fetchFn(`${this.base}/${name}.gz`);
    if (!r.ok) throw new Error(`Could not load ${name}.gz (HTTP ${r.status})`);
    let buf = await r.arrayBuffer();
    // Some servers label .gz files "Content-Encoding: gzip", and the browser then unpacks them
    // before we see them. Only decompress a body that is still the stored size and starts
    // with the gzip magic bytes; the size check below catches anything else.
    if (buf.byteLength === entry.stored && isGzip(buf)) {
      if (typeof DecompressionStream === 'undefined')
        throw new Error('This browser cannot decompress the data (DecompressionStream is missing)');
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if (buf.byteLength !== entry.size)
      throw new Error(`${name} is corrupt: expected ${entry.size} bytes, got ${buf.byteLength}`);
    return buf;
  }

  async json<T>(name: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.buffer(name))) as T;
  }
}
