// The brand gate and the license gate, as the release depends on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBrand, findBrandHits } from '../scripts/check-brand.mjs';
import { checkBuiltArtifact } from '../scripts/check-built-artifact.mjs';
import { checkDependencyLicenses, checkLegalFiles } from '../scripts/check-licenses.mjs';
import {
	upstreamCliName,
	upstreamInternalPath,
	upstreamName,
	upstreamReportingHost,
	upstreamRuntimeName,
} from '../scripts/lib/brand-terms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the repository carries no upstream name outside the legal attribution files', () => {
  assert.deepEqual(checkBrand(root), []);
});

test('an upstream name is a word: camelCase, scopes, env names and dot-dirs count; embedded letters do not', () => {
  const hits = (line) => findBrandHits('src/example.ts', line).map((hit) => hit.term);
  const camel = `mini${upstreamName.slice(4, 5).toUpperCase()}${upstreamName.slice(5)}Files`;
  assert.deepEqual(hits(`const ${camel} = 1;`), [camel.slice(0, 7)]);
  assert.deepEqual(hits(`import x from '@${upstreamRuntimeName}/shared';`), [upstreamRuntimeName]);
  assert.deepEqual(hits(`process.env.${upstreamRuntimeName.toUpperCase()}_DATA_DIR`), [
    upstreamRuntimeName.toUpperCase(),
  ]);
  assert.deepEqual(hits(`path.join(home, '.${upstreamCliName}')`), [upstreamCliName]);
  assert.deepEqual(hits(`class ${upstreamCliName[0].toUpperCase()}${upstreamCliName.slice(1)}Agent {}`), [
    `${upstreamCliName[0].toUpperCase()}${upstreamCliName.slice(1)}`,
  ]);
  assert.deepEqual(hits(`'DefinitelyMissing${upstreamRuntimeName[0].toUpperCase()}${upstreamRuntimeName.slice(1)}Module'`), [
    `${upstreamRuntimeName[0].toUpperCase()}${upstreamRuntimeName.slice(1)}`,
  ]);
  assert.deepEqual(hits(`https://data.${upstreamReportingHost}ai.com/x`), [upstreamReportingHost]);
  assert.deepEqual(hits('String.fromCodePoint(cp); const upstreamCode = 1; readonly systemCode?: string;'), []);
});

test('the legal attribution files are allowed; every other file is not', () => {
  assert.deepEqual(findBrandHits('THIRD_PARTY_NOTICES.md', `Copyright (c) 2026 ${upstreamName} Code`), []);
  assert.deepEqual(findBrandHits('LICENSE', `derived from ${upstreamName} Code`), []);
  assert.deepEqual(findBrandHits('packages/local-runtime/assets/skills/docx/LICENSE', `Copyright (c) 2026 ${upstreamName}AI`), []);
  assert.equal(findBrandHits('README.md', `Built by the ${upstreamName} team.`).length, 1);
  assert.equal(findBrandHits('src/a.ts', `const legacy = '.${upstreamRuntimeName}';`).length, 1);
});

test('the built artifact carries no address of the vendor the code base was derived from', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const scratch = mkdtempSync(path.join(tmpdir(), 'alran-artifact-gate-'));
  try {
    mkdirSync(path.join(scratch, 'chunks'), { recursive: true });
    writeFileSync(path.join(scratch, 'chunks', 'chunk.js'), 'const endpoint = "https://api.ottili.one";');
    assert.deepEqual(checkBuiltArtifact(scratch), []);
    writeFileSync(
      path.join(scratch, 'chunks', 'chunk.js'),
      `const endpoint = "http://matrix-archon-biz-default.${upstreamInternalPath}.svc.cluster.local:8080";`,
    );
    const hits = checkBuiltArtifact(scratch);
    assert.equal(hits.length, 1);
    assert.match(hits[0].term, /internal service address/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
