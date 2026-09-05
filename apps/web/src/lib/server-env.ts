/**
 * The repository's own environment file, loaded once, on the server.
 *
 * The framework reads environment files from the application directory, and
 * this is a workspace inside a monorepo whose one environment file sits at the
 * repository root, beside the example that documents it. The API loads that
 * file with node's own loader and the web app does the same.
 *
 * The loader does not overwrite a variable that is already set, so a
 * deployment that puts its variables in the process environment is unaffected,
 * and a clone with no file at all simply has none of them.
 *
 * Called only from modules that read a private variable, and those modules are
 * only ever loaded on the server. Nothing here reaches the browser bundle.
 *
 * https://nodejs.org/api/process.html#processloadenvfilepath
 */

let loaded = false;

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // No file, which is a clone that configures itself another way.
  }
}

/**
 * A private variable's value, or null when it is unset or empty.
 *
 * Never a NEXT_PUBLIC one: the web image inlines those at build time, so a
 * secret read through here would be in the bundle.
 */
export function serverVar(name: string): string | null {
  const direct = process.env[name];
  if (direct !== undefined && direct.trim() !== '') return direct.trim();
  loadRootEnv();
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

/** A private flag, off unless it is set to exactly "true". */
export function serverFlag(name: string): boolean {
  return serverVar(name) === 'true';
}
