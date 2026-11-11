#!/usr/bin/env node
// The brand gate: no name or host of the code base Alran Code was derived from may reach the product.
//
// `pnpm lint:no-minimax` fails when one of the names below appears in a file of the repository —
// code, comments, strings, tests, docs, workflows, config — outside of three kinds of places:
//
//   legal attribution   the files that must name the origin because the license requires it
//                       (LICENSE, NOTICE, THIRD_PARTY_NOTICES.md, LICENSE-STATUS.md, the migration
//                       guide) and the one attribution line of each README;
//   compatibility       a line marked `legacy-brand-compat` (or the line after such a marker), or a
//                       block between `legacy-brand-compat:begin` and `legacy-brand-compat:end`. Every
//                       such block carries a `TODO: remove after 2027-Q1`;
//   the gates           this script, the license gate and their test, which have to spell the
//                       names to look for them.
//
// A name counts as a word: `upstreamCode` and `fromCodePoint` contain the letters of an old name but
// are not it, while `miniMaxFiles`, `McodeAgent`, `@mavis/x`, `MAVIS_DATA_DIR` and `.mavis` are.
//
// Usage: node scripts/check-brand.mjs [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The names: the upstream product, its CLI and runtime names, and the companies' hosts. */
export const BRAND_TERMS = Object.freeze([
  'minimax',
  'mini-max',
  'mcode',
  'mavis',
  'hailuo',
  'xingyeai',
  'talkie-ai',
]);

/** Files that must name the origin (legal attribution) or that implement this gate. */
export const ALLOWED_FILES = Object.freeze(new Set([
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE-STATUS.md',
  // The docx skill came with its own MIT license; its copyright line names its author and stays.
  'packages/local-runtime/assets/skills/docx/LICENSE',
  'docs/MIGRATION_FROM_MINIMAX.md',
  'scripts/check-brand.mjs',
  'scripts/check-licenses.mjs',
  'test/brand-gate.test.mjs',
]));

/** Single attribution lines a README must carry (MIT: the origin's notice travels with the code). */
export const ALLOWED_LINES = Object.freeze({
  'README.md': [/derived from MiniMax Code/u],
  'docs/RELEASE_NOTES.md': [/derived from MiniMax Code/u],
  'docs/ARCHITECTURE.md': [/derived from MiniMax Code/u],
});

/** Names of this tooling that contain an old name by request: the gate's script and the migration guide. */
export const ALLOWED_TOKENS = Object.freeze(['lint:no-minimax', 'MIGRATION_FROM_MINIMAX']);

const MARKER = 'legacy-brand-compat';
const TERM_PATTERN = new RegExp(BRAND_TERMS.map((term) => term.replace(/[.]/gu, '\\.')).join('|'), 'giu');

/** True when a match starts a word: not preceded by a letter, or a camelCase boundary (`xMavis`). */
function startsWord(line, index) {
  if (index === 0) return true;
  const before = line[index - 1];
  if (!/[A-Za-z]/u.test(before)) return true;
  return /[a-z]/u.test(before) && /[A-Z]/u.test(line[index]);
}

/** The hits of one file's text, with the compatibility markers applied. */
export function findBrandHits(relativePath, text) {
  if (ALLOWED_FILES.has(relativePath)) return [];
  const allowedLines = ALLOWED_LINES[relativePath] ?? [];
  const lines = text.split(/\r?\n/u);
  const hits = [];
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = ALLOWED_TOKENS.reduce((text, token) => text.split(token).join(' '.repeat(token.length)), lines[index]);
    if (line.includes(`${MARKER}:begin`)) inBlock = true;
    // The line after a single-line marker is covered; the line after a block's end marker is not.
    const previous = index > 0 ? lines[index - 1] : '';
    const marked = inBlock || line.includes(MARKER) || (previous.includes(MARKER) && !previous.includes(`${MARKER}:end`));
    if (line.includes(`${MARKER}:end`)) inBlock = false;
    if (marked || allowedLines.some((pattern) => pattern.test(line))) continue;
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
      `\nBrand gate failed: ${hits.length} reference(s) to the upstream product outside legal attribution and marked compatibility code.\n` +
        'Rename it, or — for a compatibility path that must read an old name — mark it with `legacy-brand-compat` and a TODO: remove after 2027-Q1.\n',
    );
  } else {
    process.stdout.write('Brand gate passed: no upstream names outside legal attribution and marked compatibility code.\n');
  }
  if (hits.length > 0) process.exitCode = 1;
}
