#!/usr/bin/env node
// The brand gate: no name or host of the code base Alran Code was derived from may reach the product.
//
// `pnpm lint:brand` fails when one of the names appears in a file of the repository — code, comments,
// strings, tests, docs, workflows, config — outside of the files that must name the origin because the
// license requires it (LICENSE, NOTICE, THIRD_PARTY_NOTICES.md, LICENSE-STATUS.md and the one nested
// license of bundled upstream material).
//
// The names themselves live base64-encoded in `scripts/lib/brand-terms.mjs`: this gate has to look for
// them, and the repository must not contain them. Nothing outside that module may spell them out.
//
// A name counts as a word: a word that merely contains the letters of an old name is not it, while a
// camelCase spelling, a package scope, an environment variable and a dot-directory all are.
//
// Usage: node scripts/check-brand.mjs [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND_TERMS } from './lib/brand-terms.mjs';

export { BRAND_TERMS };

/** The files that must name the origin because the license requires it. */
export const ALLOWED_FILES = Object.freeze(new Set([
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE-STATUS.md',
  // The docx skill came with its own MIT license; its copyright line names its author and stays.
  'packages/local-runtime/assets/skills/docx/LICENSE',
]));

const TERM_PATTERN = new RegExp(
  BRAND_TERMS.map((term) => term.replace(/[.]/gu, '\\.')).join('|'),
  'giu',
);

/** True when a match starts a word: not preceded by a letter, or at a camelCase boundary. */
function startsWord(line, index) {
  if (index === 0) return true;
  const before = line[index - 1];
  if (!/[A-Za-z]/u.test(before)) return true;
  return /[a-z]/u.test(before) && /[A-Z]/u.test(line[index]);
}

/** The hits of one file's text. */
export function findBrandHits(relativePath, text) {
  if (ALLOWED_FILES.has(relativePath)) return [];
  const lines = text.split(/\r?\n/u);
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    TERM_PATTERN.lastIndex = 0;
    let match;
    while ((match = TERM_PATTERN.exec(line)) !== null) {
      if (!startsWord(line, match.index)) continue;
      hits.push({ file: relativePath, line: index + 1, term: match[0], text: line.trim().slice(0, 200) });
    }
  }
  return hits;
}

/** The files of the repository: tracked, plus untracked ones that are not ignored. */
function repositoryFiles(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const listed = `${run(['ls-files', '-z'])}${run(['ls-files', '-z', '--others', '--exclude-standard'])}`;
  return [...new Set(listed.split('\0').filter(Boolean))].sort();
}

export function checkBrand(root) {
  const hits = [];
  for (const file of repositoryFiles(root)) {
    const absolute = path.join(root, file);
    let buffer;
    try {
      if (!statSync(absolute).isFile()) continue;
      buffer = readFileSync(absolute);
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue; // binary
    hits.push(...findBrandHits(file, buffer.toString('utf8')));
  }
  return hits;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hits = checkBrand(root);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
  } else if (hits.length > 0) {
    for (const hit of hits) process.stderr.write(`${hit.file}:${hit.line}: "${hit.term}" — ${hit.text}\n`);
    process.stderr.write(
      `\nBrand gate failed: ${hits.length} reference(s) to the upstream product outside the legal attribution files.\n` +
        'Rename it. Only LICENSE, NOTICE, THIRD_PARTY_NOTICES.md, LICENSE-STATUS.md and nested licenses of bundled upstream material may name the origin.\n',
    );
  } else {
    process.stdout.write('Brand gate passed: no upstream names outside the legal attribution files.\n');
  }
  if (hits.length > 0) process.exitCode = 1;
}
