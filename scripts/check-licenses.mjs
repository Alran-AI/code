#!/usr/bin/env node
// The license gate (`pnpm license-check`).
//
// 1. The legal files are present and say what they must: LICENSE carries the MIT text and the
//    reference to the MIT-licensed upstream; THIRD_PARTY_NOTICES.md carries the upstream's full
//    license text and copyright notice and the list of modifications.
// 2. Every dependency in `release/dependency-licenses.json` (generated from `pnpm licenses list`)
//    has a license on the allow-list, or is a reviewed exception listed in THIRD_PARTY_NOTICES.md.
//    A copyleft-only license (GPL, LGPL, AGPL, SSPL, EUPL) or an unknown one fails the gate.
//
// Usage: node scripts/check-licenses.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_LICENSES = Object.freeze(new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
]));

/** Reviewed exceptions: permissive licenses outside the short list, and dual licenses taken as permissive. */
export const REVIEWED_EXCEPTIONS = Object.freeze(new Map([
  ['BlueOak-1.0.0', 'permissive'],
  ['Python-2.0', 'permissive (PSF)'],
  ['(MIT OR WTFPL)', 'used under MIT'],
  ['(MIT OR GPL-3.0-or-later)', 'used under MIT'],
  ['(BSD-3-Clause OR GPL-2.0)', 'used under BSD-3-Clause'],
  ['(MIT AND Zlib)', 'both permissive'],
  ['(MIT OR CC0-1.0)', 'used under MIT'],
  ['(BSD-2-Clause OR MIT OR Apache-2.0)', 'used under MIT'],
]));

const UPSTREAM_COPYRIGHT = 'Copyright (c) 2026 MiniMax Code';
/** Nested license files of upstream material, with the copyright line each must keep. */
export const UPSTREAM_NESTED_NOTICES = Object.freeze({
  'packages/local-runtime/assets/skills/docx/LICENSE': 'Copyright (c) 2026 MiniMaxAI',
});
const MIT_PERMISSION = 'Permission is hereby granted, free of charge, to any person obtaining a copy';

export function checkLegalFiles(root) {
  const problems = [];
  const read = (name) => {
    try { return readFileSync(path.join(root, name), 'utf8'); } catch { problems.push(`${name}: missing`); return ''; }
  };
  const license = read('LICENSE');
  if (license && !license.startsWith('MIT License')) problems.push('LICENSE: does not start with the MIT License text');
  if (license && !license.includes(MIT_PERMISSION)) problems.push('LICENSE: MIT permission notice missing');
  if (license && !/derived from MiniMax Code/u.test(license)) problems.push('LICENSE: reference to the upstream (MiniMax Code) missing');
  if (license && !license.includes('THIRD_PARTY_NOTICES.md')) problems.push('LICENSE: pointer to THIRD_PARTY_NOTICES.md missing');
  const notices = read('THIRD_PARTY_NOTICES.md');
  if (notices && !notices.includes(UPSTREAM_COPYRIGHT)) problems.push('THIRD_PARTY_NOTICES.md: upstream copyright notice missing');
  if (notices && !notices.includes(MIT_PERMISSION)) problems.push('THIRD_PARTY_NOTICES.md: upstream MIT permission notice missing');
  if (notices && !notices.includes('https://github.com/minimax-ai/minimax-code')) problems.push('THIRD_PARTY_NOTICES.md: upstream source URL missing');
  if (notices && !/Modifications made to MiniMax Code/u.test(notices)) problems.push('THIRD_PARTY_NOTICES.md: list of modifications missing');
  read('NOTICE');
  // Bundled upstream material that came with a license of its own keeps its copyright line (MIT:
  // "The above copyright notice … shall be included"); a rename once replaced one with our name.
  for (const [file, holder] of Object.entries(UPSTREAM_NESTED_NOTICES)) {
    const text = read(file);
    if (text && !text.includes(holder)) problems.push(`${file}: the original copyright line "${holder}" was changed`);
  }
  return problems;
}

export function checkDependencyLicenses(root) {
  const inventory = JSON.parse(readFileSync(path.join(root, 'release/dependency-licenses.json'), 'utf8'));
  const problems = [];
  for (const entry of inventory.packages ?? []) {
    const license = String(entry.license ?? '').trim();
    if (ALLOWED_LICENSES.has(license) || REVIEWED_EXCEPTIONS.has(license)) continue;
    problems.push(`${entry.name}@${(entry.versions ?? []).join(',')}: license "${license || 'unknown'}" is neither allowed nor a reviewed exception`);
  }
  return problems;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = [...checkLegalFiles(root), ...checkDependencyLicenses(root)];
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.stderr.write(`\nLicense gate failed: ${problems.length} problem(s).\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('License gate passed: LICENSE and THIRD_PARTY_NOTICES.md are complete, every dependency license is allowed or reviewed.\n');
  }
}
