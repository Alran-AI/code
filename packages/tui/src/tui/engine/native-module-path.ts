import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRequire = createRequire(import.meta.url);
const ALRAN_PACKAGE_JSONS = ['alran/package.json', '@ottili/alran-code/package.json'] as const;

export interface NativeModuleCandidateOptions {
  moduleUrl?: string;
  execPath?: string;
  resolvePackage?: (specifier: string) => string;
}

export function getNativeModuleCandidates(
  nativePath: string,
  options: NativeModuleCandidateOptions = {},
): string[] {
  const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url));
  const candidates: string[] = [];

  for (const specifier of ALRAN_PACKAGE_JSONS) {
    try {
      const packageJson = (options.resolvePackage ?? moduleRequire.resolve)(specifier);
      candidates.push(join(dirname(packageJson), nativePath));
      break;
    } catch {
      // Standalone binaries do not have an installed `alran` package.
    }
  }

  candidates.push(
    join(moduleDir, '..', nativePath),
    join(moduleDir, nativePath),
    join(dirname(options.execPath ?? process.execPath), nativePath),
  );
  return Array.from(new Set(candidates));
}
