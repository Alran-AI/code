import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parsePluginArchive } from '../../../local-runtime-v2/src/service/plugin-system/plugin/package/archive-format.js';
import {
  assertPortablePath,
  computeContentDigest,
  readStoreArchive,
  StoreArchiveError,
} from '../../src/store/archive.js';
import { buildArchive, rawZip } from '../helpers/store-fixtures.js';

interface VectorCase {
  readonly name: string;
  readonly entries: readonly { path?: string; kind: string; contentUtf8?: string; compression?: string }[];
  readonly expect: { readonly valid: boolean; readonly error?: string };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../../test-vectors/plugins/content-digest-v1.source.json', import.meta.url), 'utf8'),
) as { cases: VectorCase[] };

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreArchiveError) return error.code;
    throw error;
  }
  return 'no error';
}

const file = (path: string, text = 'x') => ({ path, content: Buffer.from(text) });

describe('store archive reader', () => {
  it('reads what the builder writes and agrees with the runtime parser on the digest', () => {
    const files = [
      file('.alran-plugin/plugin.json', '{"schemaVersion":1}'),
      file('skills/research/SKILL.md', 'hello'),
      file('EMPTY', ''),
      { path: 'binary.bin', content: Buffer.from([0, 1, 2, 255, 254]) },
    ];
    const archive = buildArchive(files) as Buffer;
    const mine = readStoreArchive(archive);
    const runtime = parsePluginArchive(archive);
    expect(mine.contentDigest).toBe(runtime.digest.contentDigest);
    expect(mine.files.map((entry) => entry.path)).toEqual([
      '.alran-plugin/plugin.json',
      'EMPTY',
      'binary.bin',
      'skills/research/SKILL.md',
    ]);
    expect(mine.files.find((entry) => entry.path === 'binary.bin')?.content).toEqual(
      Buffer.from([0, 1, 2, 255, 254]),
    );
    expect(mine.totalBytes).toBe(files.reduce((sum, entry) => sum + entry.content.length, 0));
  });

  it('computes the same digest for any input order and reads an empty tree', () => {
    const a = [file('a.txt', '1'), file('b/c.txt', '2')];
    expect(computeContentDigest(a)).toBe(computeContentDigest([...a].reverse()));
    expect(readStoreArchive(buildArchive([]) as Buffer).files).toEqual([]);
    expect(computeContentDigest([file('a.txt', '1')])).not.toBe(computeContentDigest([file('a.txt', '2')]));
  });

  it('builds byte-identical archives for the same tree', () => {
    const files = [file('b.txt', 'b'), file('a.txt', 'a')];
    expect(buildArchive(files)).toEqual(buildArchive([...files].reverse()));
  });

  it('refuses every invalid path the published vectors list', () => {
    const invalid = vectors.cases.filter(
      (entry) =>
        !entry.expect.valid &&
        entry.entries.every((item) => item.kind === 'file' && item.contentUtf8 !== undefined && !item.compression),
    );
    expect(invalid.length).toBeGreaterThanOrEqual(10);
    for (const vector of invalid) {
      const archive = rawZip(
        vector.entries.map((item) => ({ name: item.path ?? '', content: Buffer.from(item.contentUtf8 ?? '') })),
      );
      expect(errorCode(() => readStoreArchive(archive)), vector.name).toBe(vector.expect.error);
    }
  });

  it.each([
    ['a symlink', { name: 'link', versionMadeBy: (3 << 8) | 20, externalAttributes: (0o120777 << 16) >>> 0 }, 'SYMLINK_NOT_ALLOWED'],
    ['a socket', { name: 's', externalAttributes: (0o140755 << 16) >>> 0 }, 'SPECIAL_ENTRY_NOT_ALLOWED'],
    ['deflate', { name: 'a.txt', method: 8 }, 'UNSUPPORTED_COMPRESSION'],
    ['encryption', { name: 'a.txt', flags: 1 }, 'ENCRYPTION_NOT_ALLOWED'],
    ['a data descriptor', { name: 'a.txt', flags: 8 }, 'DATA_DESCRIPTOR_NOT_ALLOWED'],
    ['an extra field', { name: 'a.txt', extra: Buffer.from([1, 2, 3, 4]) }, 'EXTRA_FIELD_NOT_ALLOWED'],
    ['an entry comment', { name: 'a.txt', comment: Buffer.from('c') }, 'ENTRY_COMMENT_NOT_ALLOWED'],
    ['a lying size', { name: 'a.txt', content: Buffer.from('abc'), centralUncompressedSize: 9 }, 'SIZE_MISMATCH'],
  ])('refuses %s', (_label, entry, code) => {
    expect(errorCode(() => readStoreArchive(rawZip([entry])))).toBe(code);
  });

  it('refuses a ZIP comment, truncation and garbage', () => {
    expect(errorCode(() => readStoreArchive(rawZip([{ name: 'a' }], Buffer.from('hi'))))).toBe('INVALID_ZIP');
    const archive = buildArchive([file('a.txt', 'abc')]) as Buffer;
    expect(errorCode(() => readStoreArchive(archive.subarray(0, archive.length - 5)))).toBe('INVALID_ZIP');
    expect(errorCode(() => readStoreArchive(Buffer.from('not a zip at all, definitely')))).toBe('INVALID_ZIP');
    expect(errorCode(() => readStoreArchive(Buffer.alloc(4)))).toBe('INVALID_ZIP');
  });

  it('refuses a corrupted body through the CRC', () => {
    const archive = Buffer.from(buildArchive([file('a.txt', 'abcdef')]) as Buffer);
    const at = archive.indexOf('abcdef');
    archive[at] = 0x58;
    expect(errorCode(() => readStoreArchive(archive))).toBe('CRC_MISMATCH');
  });

  it('refuses a file over the per-file limit', () => {
    const archive = rawZip([{ name: 'large.bin', content: Buffer.alloc(16 * 1024 * 1024 + 1) }]);
    expect(errorCode(() => readStoreArchive(archive))).toBe('FILE_TOO_LARGE');
  });

  it('accepts directory entries and ignores them in the digest', () => {
    const withDirectory = rawZip([
      { name: 'assets/', externalAttributes: (0o040755 << 16) >>> 0 },
      { name: 'a.txt', content: Buffer.from('1') },
    ]);
    expect(readStoreArchive(withDirectory).contentDigest).toBe(computeContentDigest([file('a.txt', '1')]));
  });

  it('reads a Plugin that holds a whole source of Skills', () => {
    // The largest Plugin of the Store holds 10,691 files; it used to be refused as too many.
    const files = Array.from({ length: 3_000 }, (_value, index) =>
      file(`skills/skill-${index}/SKILL.md`, `name: skill-${index}`),
    );
    const archive = buildArchive(files) as Buffer;

    const mine = readStoreArchive(archive);
    const runtime = parsePluginArchive(archive);

    expect(mine.files).toHaveLength(3_000);
    expect(mine.contentDigest).toBe(runtime.digest.contentDigest);
  });

  it('refuses an archive with more files than the limit', () => {
    const files = Array.from({ length: 16_385 }, (_value, index) =>
      file(`skills/skill-${index}/SKILL.md`, 'x'),
    );
    const archive = buildArchive(files) as Buffer;
    expect(errorCode(() => readStoreArchive(archive))).toBe('TOO_MANY_ENTRIES');
  });

  it('checks portable paths on their own', () => {
    expect(() => assertPortablePath('skills/research/SKILL.md')).not.toThrow();
    expect(() => assertPortablePath('a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q')).toThrow(StoreArchiveError);
    expect(() => assertPortablePath('NUL.txt')).toThrow(StoreArchiveError);
    expect(() => assertPortablePath('dir/')).toThrow(StoreArchiveError);
    expect(() => assertPortablePath('C:/x')).toThrow(StoreArchiveError);
    expect(() => assertPortablePath('a\u0000b')).toThrow(StoreArchiveError);
  });
});
