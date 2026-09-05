import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package resolves the repository root by walking up from its own source
 * rather than from the working directory, so the CLIs and the tests find
 * data/bls whichever directory they were started from.
 */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not find the repository root above the index-model package');
}

export function archiveRoot(): string {
  return join(repoRoot(), 'data', 'bls');
}

export function hasArchive(): boolean {
  return existsSync(join(archiveRoot(), 'PROVENANCE.txt'));
}

/** Raw fetches are cached here. The path is gitignored by the cache/ rule. */
export function cacheRoot(): string {
  return resolve(process.env.BLS_CACHE_DIR ?? join(repoRoot(), 'var', 'cache', 'bls'));
}

export function docsRoot(): string {
  return join(repoRoot(), 'docs');
}
