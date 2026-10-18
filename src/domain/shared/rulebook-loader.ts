import * as fs from 'node:fs';
import * as path from 'node:path';

/** Loads a versioned JSON rulebook from config/rulebooks and checks the required keys exist. */
export function loadRulebook<T extends { version: string }>(
  fileName: string,
  requiredKeys: readonly (keyof T)[],
  file?: string,
): T {
  const resolved =
    file ?? path.resolve(process.cwd(), 'config', 'rulebooks', fileName);
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Partial<T>;
  for (const key of requiredKeys) {
    if (raw[key] === undefined)
      throw new Error(`Rulebook ${fileName} is missing "${String(key)}"`);
  }
  return raw as T;
}
