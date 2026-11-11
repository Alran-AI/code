#!/usr/bin/env node
// Stage the npm package `alran` from the current build and run `npm publish --dry-run`.
//
// This is the readiness check of a release, not the release: it does not need a tag or a clean tree,
// and it never publishes. The real archive is built by `scripts/package-cli-release.mjs <tag> <out>`
// from a tagged, clean, verified commit, and a founder publishes it (docs/UPDATE_PIPELINE.md).
//
// Usage: pnpm build && node scripts/npm-publish-dry-run.mjs [--pack <dir>]
//
// `--pack <dir>` also writes the staged package as a tarball into <dir>, so the exact archive a publish
// would upload can be installed and tried (`npm install -g <dir>/alran-<version>.tgz`).
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseManifest } from './package-cli-release.mjs';
import { readExtraction } from './lib/release-metadata.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
if (!existsSync(path.join(dist, 'cli.js'))) throw new Error('Build first: pnpm build');
const packIndex = process.argv.indexOf('--pack');
const packDir = packIndex === -1 ? null : path.resolve(process.argv[packIndex + 1] ?? '');
if (packIndex !== -1 && !process.argv[packIndex + 1]) throw new Error('--pack needs a directory');
const version = JSON.parse(readFileSync(path.join(dist, 'package.json'), 'utf8')).version;
const temporary = mkdtempSync(path.join(tmpdir(), 'alran-npm-'));
try {
  const stage = path.join(temporary, 'package');
  cpSync(dist, stage, { recursive: true, filter: (file) => path.basename(file) !== 'metafile.json' });
  const manifest = releaseManifest(readExtraction(root).packageRoots.map((directory) => path.join(root, directory)), version);
  writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const name of ['LICENSE', 'NOTICE', 'LICENSE-STATUS.md', 'THIRD_PARTY_NOTICES.md', 'README.md']) {
    copyFileSync(path.join(root, name), path.join(stage, name));
  }
  const output = execFileSync('npm', ['publish', '--dry-run', '--json', '--ignore-scripts'], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const report = JSON.parse(output.slice(output.indexOf('{')));
  const files = report.files ?? [];
  const legal = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'NOTICE'].filter((name) => files.some((file) => file.path === name));
  process.stdout.write(`${JSON.stringify({
    name: report.name,
    version: report.version,
    files: report.entryCount ?? files.length,
    packed_bytes: report.size,
    unpacked_bytes: report.unpackedSize,
    legal_files: legal,
    bin: manifest.bin,
    dependencies: manifest.dependencies,
    optionalDependencies: manifest.optionalDependencies,
  }, null, 2)}\n`);
  if (legal.length !== 3) throw new Error('The package must carry LICENSE, NOTICE and THIRD_PARTY_NOTICES.md.');
  if (packDir) {
    const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', packDir], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(`tarball: ${path.join(packDir, packed.trim().split('\n').at(-1))}\n`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
