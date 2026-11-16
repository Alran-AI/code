#!/usr/bin/env node
// The built artifact may not carry the vendor the code base was derived from.
//
// The brand gate (`scripts/check-brand.mjs`) reads the tracked source tree, and
// `dist/` is not tracked, so a hand-patched build output would pass it. This
// check reads the build output instead and fails when an address of that vendor
// reaches it.
//
// It looks for reporting endpoints and internal service addresses, not for every
// spelling of the product name: the build output carries the old product name
// in the compatibility code that reads the old environment variables, and that
// code is marked as compatibility in the source.
//
// Usage: node scripts/check-built-artifact.mjs [--json] [--dir <path>]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { embeddedCredential, internalSourceReference } from './lib/public-text-policy.mjs';

/** The addresses of the vendor the code base was derived from. None of them may ship. */
// legacy-brand-compat:begin
export const VENDOR_ADDRESS_PATTERNS = Object.freeze([
	{ term: 'reporting endpoint', pattern: /data\.hailuo(?:ai)?\.com/giu },
	{ term: 'reporting endpoint', pattern: /bigdata-test\.(?:xingyeai|talkie-ai)\.com/giu },
	{ term: 'reporting endpoint', pattern: /meerkat-reporter/giu },
	{ term: 'host', pattern: /minimaxi\.com/giu },
	{ term: 'internal service address', pattern: /[\w.-]+\.svc\.cluster\.local/giu },
]);
// legacy-brand-compat:end

/** The files of the build output. */
function artifactFiles(directory, prefix = '') {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		const absolute = path.join(directory, entry.name);
		return entry.isDirectory() ? artifactFiles(absolute, relative) : [relative];
	});
}

/** Every reference to the vendor in the build output. */
export function checkBuiltArtifact(directory) {
	const hits = [];
	for (const relative of artifactFiles(directory)) {
		const absolute = path.join(directory, relative);
		let buffer;
		try {
			if (!statSync(absolute).isFile()) continue;
			buffer = readFileSync(absolute);
		} catch {
			continue;
		}
		if (buffer.includes(0)) continue; // binary
		const text = buffer.toString('utf8');
		for (const { term, pattern } of VENDOR_ADDRESS_PATTERNS) {
			pattern.lastIndex = 0;
			const match = pattern.exec(text);
			if (match) {
				hits.push({ file: relative, term, text: match[0].slice(0, 120) });
			}
		}
		if (internalSourceReference.test(text)) {
			hits.push({ file: relative, term: 'internal source reference', text: '' });
		}
		if (embeddedCredential.test(text)) {
			hits.push({ file: relative, term: 'embedded credential', text: '' });
		}
	}
	return hits;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const directoryIndex = process.argv.indexOf('--dir');
	const directory =
		directoryIndex >= 0 && process.argv[directoryIndex + 1]
			? path.resolve(process.argv[directoryIndex + 1])
			: path.join(root, 'dist');
	let hits = [];
	try {
		hits = checkBuiltArtifact(directory);
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			process.stderr.write(`No build output at ${directory}. Build the artifact first.\n`);
			process.exitCode = 1;
		} else {
			throw error;
		}
	}
	if (process.argv.includes('--json')) {
		process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
	} else if (hits.length > 0) {
		for (const hit of hits) {
			process.stderr.write(`${hit.file}: ${hit.term}${hit.text ? ` — "${hit.text}"` : ''}\n`);
		}
		process.stderr.write(
			`\nBuilt-artifact gate failed: ${hits.length} reference(s) to the vendor the code base was derived from.\n` +
				'The build output is not tracked, so the source brand gate does not read it. Remove the reference from the source and rebuild.\n',
		);
	} else {
		process.stdout.write(
			`Built-artifact gate passed: no vendor address in ${path.relative(root, directory) || '.'}.\n`,
		);
	}
	if (hits.length > 0) process.exitCode = 1;
}
