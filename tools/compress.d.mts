export interface StoredFile {
  size: number;
  stored: number;
  sha256: string;
}
export function compressDirectory(
  dir: string,
  options?: { level?: number },
): Promise<{ skipped: boolean; files: Record<string, StoredFile> }>;
export function verifyDirectory(dir: string): Promise<string[]>;
