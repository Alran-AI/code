// The brand gate and the license gate, as the release depends on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBrand, findBrandHits } from '../scripts/check-brand.mjs';
import { checkDependencyLicenses, checkLegalFiles } from '../scripts/check-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the repository carries no upstream name outside legal attribution and marked compatibility code', () => {
  assert.deepEqual(checkBrand(root), []);
});

test('an upstream name is a word: camelCase, scopes, env names and dot-dirs count; embedded letters do not', () => {
  const hits = (line) => findBrandHits('src/example.ts', line).map((hit) => hit.term);
  assert.deepEqual(hits('const miniMaxFiles = 1;'), ['miniMax']);
  assert.deepEqual(hits("import x from '@mavis/shared';"), ['mavis']);
  assert.deepEqual(hits('process.env.MAVIS_DATA_DIR'), ['MAVIS']);
  assert.deepEqual(hits("path.join(home, '.mcode')"), ['mcode']);
  assert.deepEqual(hits('class McodeAgent {}'), ['Mcode']);
  assert.deepEqual(hits("'DefinitelyMissingMavisModule'"), ['Mavis']);
  assert.deepEqual(hits('https://data.hailuoai.com/x'), ['hailuo']);
  assert.deepEqual(hits('String.fromCodePoint(cp); const upstreamCode = 1; readonly systemCode?: string;'), []);
});

test('a marked compatibility path and the legal files are allowed; an unmarked one is not', () => {
  assert.deepEqual(findBrandHits('src/a.ts', "// legacy-brand-compat: TODO: remove after 2027-Q1\nconst LEGACY = '.mavis';"), []);
  assert.deepEqual(findBrandHits('src/a.ts', "// legacy-brand-compat:begin\nconst a = '.mavis';\nconst b = 'MAVIS_';\n// legacy-brand-compat:end"), []);
  assert.equal(findBrandHits('src/a.ts', "// legacy-brand-compat:begin\nconst a = 1;\n// legacy-brand-compat:end\nconst b = '.mavis';").length, 1);
  assert.deepEqual(findBrandHits('THIRD_PARTY_NOTICES.md', 'Copyright (c) 2026 MiniMax Code'), []);
  assert.deepEqual(findBrandHits('README.md', 'Alran Code is derived from MiniMax Code (mcode).'), []);
  assert.equal(findBrandHits('README.md', 'Built by the MiniMax team.').length, 1);
});

test('LICENSE and THIRD_PARTY_NOTICES.md say what the MIT license of the upstream requires', () => {
  assert.deepEqual(checkLegalFiles(root), []);
});

test('every dependency license is allowed or a reviewed exception', () => {
  assert.deepEqual(checkDependencyLicenses(root), []);
});

test('a bundled upstream license keeps its original copyright line', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { UPSTREAM_NESTED_NOTICES } = await import('../scripts/check-licenses.mjs');
  const scratch = mkdtempSync(path.join(tmpdir(), 'alran-license-gate-'));
  try {
    for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(path.join(root, name), path.join(scratch, name));
    const [file, holder] = Object.entries(UPSTREAM_NESTED_NOTICES)[0];
    mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    writeFileSync(path.join(scratch, file), `MIT License\n\n${holder}\n`);
    assert.deepEqual(checkLegalFiles(scratch), []);
    writeFileSync(path.join(scratch, file), 'MIT License\n\nCopyright (c) 2026 AlranAI\n');
    assert.match(checkLegalFiles(scratch).join('\n'), /original copyright line/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
