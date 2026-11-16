// The language gate, as the release depends on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED_FILES, checkLanguage, findLanguageHits, isAllowed, sourcePathOf } from '../scripts/check-language.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The ranges are written as escapes so that this file does not contain the
// characters it looks for.
const HAN = '\u4e00\u4e8c';
const CJK_PUNCTUATION = '\u3002';

test('the repository carries no Chinese outside the files that may carry it', () => {
  assert.deepEqual(checkLanguage(root), []);
});

test('a Chinese line is a hit outside the allow list', () => {
  const hits = findLanguageHits('src/example.ts', `const label = '${HAN}';`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.equal(findLanguageHits('src/example.ts', 'const label = "plain";').length, 0);
});

test('the Chinese locale, the Chinese documents and the Chinese test data are allowed', () => {
  assert.equal(isAllowed('packages/agent-modules/permission/src/reason-format.ts'), true);
  assert.equal(isAllowed('packages/local-runtime/assets/skills/docx/references/cjk_typography.md'), true);
  assert.equal(isAllowed('packages/tui/test/unit/tui-ime-cursor.test.ts'), true);
  assert.equal(isAllowed('src/example.ts'), false);
});

test('a Chinese punctuation mark counts as Chinese', () => {
  assert.equal(findLanguageHits('src/example.ts', `// ${CJK_PUNCTUATION}`).length, 1);
});

test('a build output is mapped back to the source it was copied from', () => {
  assert.equal(
    sourcePathOf('assets/skills/docx/references/cjk_typography.md'),
    'packages/local-runtime/assets/skills/docx/references/cjk_typography.md',
  );
  assert.equal(
    sourcePathOf('assets/agents/alran/skills/control-in-app-browser/SKILL.md'),
    'packages/local-runtime-v2/assets/agents/alran/skills/control-in-app-browser/SKILL.md',
  );
});

test('a bundled file has no source of its own', () => {
  assert.equal(sourcePathOf('chunks/chunk-ABCD1234.js'), null);
  assert.equal(sourcePathOf('cli.js'), null);
});

test('every allowed entry still points at a file of the repository', () => {
  const run = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const listed = `${run(['ls-files', '-z'])}${run(['ls-files', '-z', '--others', '--exclude-standard'])}`;
  const files = new Set(listed.split('\0').filter(Boolean));
  const dead = [];
  for (const entry of ALLOWED_FILES.keys()) {
    if (entry.endsWith('/')) {
      if (!existsSync(path.join(root, entry))) dead.push(entry);
      continue;
    }
    if (!files.has(entry)) dead.push(entry);
  }
  assert.deepEqual(dead, [], `allow list entries without a file: ${dead.join(', ')}`);
});
