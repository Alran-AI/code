import { createHash } from 'node:crypto';

/**
 * Reader for the V1 package archive (docs/plugins/package-format-v1.md sections 3 to 6).
 *
 * The rules are the same ones `packages/local-runtime-v2` applies to registry archives; they are
 * restated here because the Store installs without the registry. `test/unit/store-archive.test.ts`
 * runs both readers over the same bytes and the published digest vectors.
 */

export const ARCHIVE_LIMITS = {
  archiveBytes: 64 * 1024 * 1024,
  entries: 2_048,
  files: 1_024,
  fileBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  pathBytes: 512,
  segmentBytes: 128,
  pathSegments: 16,
} as const;

export class StoreArchiveError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'StoreArchiveError';
  }
}

export interface StoreArchiveFile {
  readonly path: string;
  readonly content: Buffer;
}

export interface ReadArchiveResult {
  /** Regular files, sorted by path bytes. */
  readonly files: readonly StoreArchiveFile[];
  readonly contentDigest: string;
  readonly totalBytes: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_REGULAR = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_value, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_value, index) => `lpt${index + 1}`),
]);
const DIGEST_MAGIC = Buffer.from('ALRAN-PLUGIN-CONTENT-DIGEST\0', 'ascii');

/** Throws unless `relativePath` is a V1 portable ASCII path. */
export function assertPortablePath(relativePath: string): void {
  if (!relativePath) fail('INVALID_PATH', 'path is empty');
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7f]*$/u.test(relativePath)) {
    fail('NON_PORTABLE_PATH', `${JSON.stringify(relativePath)} is not ASCII`);
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:/u.test(relativePath)) {
    fail('ABSOLUTE_PATH', `${JSON.stringify(relativePath)} is absolute`);
  }
  if (relativePath.includes('\\')) {
    fail('BACKSLASH_PATH', `${JSON.stringify(relativePath)} contains a backslash`);
  }
  if (relativePath.endsWith('/')) {
    fail('INVALID_PATH', `${JSON.stringify(relativePath)} has a trailing slash`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/u.test(relativePath)) {
    fail('CONTROL_CHARACTER', `${JSON.stringify(relativePath)} contains a control character`);
  }
  if (relativePath.length > ARCHIVE_LIMITS.pathBytes) {
    fail('PATH_TOO_LONG', `${JSON.stringify(relativePath)} exceeds the path limit`);
  }
  const segments = relativePath.split('/');
  if (segments.length > ARCHIVE_LIMITS.pathSegments) {
    fail('PATH_TOO_DEEP', `${JSON.stringify(relativePath)} has too many segments`);
  }
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      fail('PATH_TRAVERSAL', `${JSON.stringify(relativePath)} has an empty or dot segment`);
    }
    if (segment.length > ARCHIVE_LIMITS.segmentBytes) {
      fail('SEGMENT_TOO_LONG', `${JSON.stringify(segment)} exceeds the segment limit`);
    }
    if (!SEGMENT_PATTERN.test(segment) || segment.endsWith('.')) {
      fail('NON_PORTABLE_PATH', `${JSON.stringify(segment)} is not portable`);
    }
    const [basename = ''] = segment.split('.', 1);
    if (WINDOWS_RESERVED.has(basename.toLowerCase())) {
      fail('WINDOWS_RESERVED_PATH', `${JSON.stringify(segment)} is reserved on Windows`);
    }
  }
}

/** `sha256-tree-v1` over regular files (package-format-v1 section 5). */
export function computeContentDigest(files: readonly StoreArchiveFile[]): string {
  const sorted = [...files].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'ascii'), Buffer.from(right.path, 'ascii')),
  );
  const hash = createHash('sha256');
  hash.update(DIGEST_MAGIC);
  hash.update(uint32(1));
  hash.update(uint32(sorted.length));
  for (const file of sorted) {
    const pathBytes = Buffer.from(file.path, 'ascii');
    hash.update(Buffer.from([0x46]));
    hash.update(uint32(pathBytes.length));
    hash.update(pathBytes);
    hash.update(uint64(file.content.length));
    hash.update(file.content);
  }
  return `sha256-tree-v1:${hash.digest('hex')}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Parses and validates a V1 archive. Never writes anything. */
export function readStoreArchive(archive: Buffer): ReadArchiveResult {
  if (archive.length > ARCHIVE_LIMITS.archiveBytes) {
    fail('ARCHIVE_TOO_LARGE', `${archive.length} bytes exceed the archive limit`);
  }
  if (archive.length < 22) fail('INVALID_ZIP', 'end-of-central-directory record is missing');
  const end = readEndRecord(archive);
  const entries = readCentralEntries(archive, end);
  const files: StoreArchiveFile[] = [];
  const ranges: { start: number; end: number }[] = [];
  const seen = new Set<string>();
  const spellings = new Map<string, string>();
  const filePaths = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const local = readLocalEntry(archive, entry, end.centralOffset);
    ranges.push({ start: entry.localOffset, end: local.end });
    const content = archive.subarray(local.data, local.end);
    if (crc32(content) !== entry.crc) fail('CRC_MISMATCH', `${entry.path} has an invalid CRC`);
    if (entry.kind === 'symlink') fail('SYMLINK_NOT_ALLOWED', `${entry.path} is a symlink`);
    if (entry.kind === 'special') fail('SPECIAL_ENTRY_NOT_ALLOWED', `${entry.path} is special`);
    assertPortablePath(entry.path);
    if (seen.has(entry.path)) fail('DUPLICATE_PATH', `${entry.path} appears twice`);
    seen.add(entry.path);
    assertNoCaseCollision(entry.path, spellings);
    if (entry.kind === 'directory') continue;
    filePaths.add(entry.path);
    if (content.length > ARCHIVE_LIMITS.fileBytes) {
      fail('FILE_TOO_LARGE', `${entry.path} exceeds the per-file limit`);
    }
    totalBytes += content.length;
    if (totalBytes > ARCHIVE_LIMITS.totalBytes) {
      fail('TOTAL_SIZE_LIMIT', 'unpacked size exceeds the total limit');
    }
    files.push({ path: entry.path, content });
  }
  if (files.length > ARCHIVE_LIMITS.files) fail('TOO_MANY_FILES', `${files.length} files`);
  assertNoOverlap(ranges);
  assertNoTypeConflicts(seen, filePaths);
  const sorted = [...files].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'ascii'), Buffer.from(right.path, 'ascii')),
  );
  return { files: sorted, contentDigest: computeContentDigest(sorted), totalBytes };
}

interface EndRecord {
  readonly endOffset: number;
  readonly entryCount: number;
  readonly centralOffset: number;
}

interface CentralEntry {
  readonly path: string;
  readonly rawName: Buffer;
  readonly kind: 'file' | 'directory' | 'symlink' | 'special';
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

function readEndRecord(archive: Buffer): EndRecord {
  const endOffset = archive.length - 22;
  expectSignature(archive, endOffset, END_RECORD, 'end-of-central-directory');
  const disk = u16(archive, endOffset + 4);
  const centralDisk = u16(archive, endOffset + 6);
  const entriesOnDisk = u16(archive, endOffset + 8);
  const entryCount = u16(archive, endOffset + 10);
  const centralSize = u32(archive, endOffset + 12);
  const centralOffset = u32(archive, endOffset + 16);
  if (u16(archive, endOffset + 20) !== 0) fail('ARCHIVE_COMMENT_NOT_ALLOWED', 'comment not empty');
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail('MULTI_DISK_NOT_ALLOWED', 'multi-disk ZIP is not supported');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail('ZIP64_NOT_ALLOWED', 'ZIP64 sentinel values are not supported');
  }
  if (entryCount > ARCHIVE_LIMITS.entries) fail('TOO_MANY_ENTRIES', `${entryCount} entries`);
  if (centralOffset + centralSize !== endOffset) {
    fail('INVALID_ZIP', 'central directory bounds do not match the archive');
  }
  return { endOffset, entryCount, centralOffset };
}

function readCentralEntries(archive: Buffer, end: EndRecord): CentralEntry[] {
  const entries: CentralEntry[] = [];
  let cursor = end.centralOffset;
  for (let index = 0; index < end.entryCount; index += 1) {
    ensureRange(archive, cursor, 46, 'central directory header');
    expectSignature(archive, cursor, CENTRAL_HEADER, 'central directory');
    const versionMadeBy = u16(archive, cursor + 4);
    const flags = u16(archive, cursor + 8);
    const method = u16(archive, cursor + 10);
    const crc = u32(archive, cursor + 16);
    const compressedSize = u32(archive, cursor + 20);
    const uncompressedSize = u32(archive, cursor + 24);
    const nameLength = u16(archive, cursor + 28);
    const extraLength = u16(archive, cursor + 30);
    const commentLength = u16(archive, cursor + 32);
    const diskStart = u16(archive, cursor + 34);
    const externalAttributes = u32(archive, cursor + 38);
    const localOffset = u32(archive, cursor + 42);
    assertFlags(flags);
    if (method !== 0) fail('UNSUPPORTED_COMPRESSION', `ZIP method ${method} is not STORE`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      fail('ZIP64_NOT_ALLOWED', 'ZIP64 entry values are not supported');
    }
    if (localOffset === 0xffffffff) fail('ZIP64_NOT_ALLOWED', 'ZIP64 offset');
    if (extraLength !== 0) fail('EXTRA_FIELD_NOT_ALLOWED', 'ZIP extra fields are not supported');
    if (commentLength !== 0) fail('ENTRY_COMMENT_NOT_ALLOWED', 'entry comments are not supported');
    if (diskStart !== 0) fail('MULTI_DISK_NOT_ALLOWED', 'entry on a non-zero disk');
    if (compressedSize !== uncompressedSize) fail('SIZE_MISMATCH', 'STORE sizes differ');
    const next = cursor + 46 + nameLength;
    ensureRange(archive, cursor + 46, nameLength, 'central entry name');
    if (next > end.endOffset) fail('INVALID_ZIP', 'central entry exceeds the directory');
    const rawName = archive.subarray(cursor + 46, next);
    if (rawName.length === 0) fail('INVALID_PATH', 'ZIP entry name is empty');
    if (rawName.some((byte) => byte > 0x7f)) fail('NON_PORTABLE_PATH', 'entry name is not ASCII');
    const rendered = rawName.toString('ascii');
    const directorySuffix = rendered.endsWith('/');
    const path = directorySuffix ? rendered.slice(0, -1) : rendered;
    const kind = classify(versionMadeBy, externalAttributes, directorySuffix);
    if (kind === 'directory' && !directorySuffix) fail('INVALID_DIRECTORY_ENTRY', path);
    if (kind !== 'directory' && directorySuffix) fail('INVALID_DIRECTORY_ENTRY', path);
    if (kind === 'directory' && uncompressedSize !== 0) fail('INVALID_DIRECTORY_ENTRY', path);
    entries.push({
      path,
      rawName,
      kind,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = next;
  }
  if (cursor !== end.endOffset) fail('INVALID_ZIP', 'central directory entry count is inconsistent');
  return entries;
}

function readLocalEntry(
  archive: Buffer,
  central: CentralEntry,
  centralOffset: number,
): { data: number; end: number } {
  const offset = central.localOffset;
  ensureRange(archive, offset, 30, 'local file header');
  expectSignature(archive, offset, LOCAL_HEADER, 'local file');
  const flags = u16(archive, offset + 6);
  const method = u16(archive, offset + 8);
  const crc = u32(archive, offset + 14);
  const compressedSize = u32(archive, offset + 18);
  const uncompressedSize = u32(archive, offset + 22);
  const nameLength = u16(archive, offset + 26);
  const extraLength = u16(archive, offset + 28);
  assertFlags(flags);
  if (extraLength !== 0) fail('EXTRA_FIELD_NOT_ALLOWED', 'local ZIP extra field is not empty');
  if (
    flags !== central.flags ||
    method !== central.method ||
    crc !== central.crc ||
    compressedSize !== central.compressedSize ||
    uncompressedSize !== central.uncompressedSize
  ) {
    fail('LOCAL_HEADER_MISMATCH', `${central.path} local and central headers differ`);
  }
  ensureRange(archive, offset + 30, nameLength, 'local entry name');
  if (!archive.subarray(offset + 30, offset + 30 + nameLength).equals(central.rawName)) {
    fail('LOCAL_HEADER_MISMATCH', `${central.path} local and central names differ`);
  }
  const data = offset + 30 + nameLength;
  const end = data + compressedSize;
  if (end > centralOffset) fail('INVALID_ZIP', `${central.path} data overlaps the directory`);
  return { data, end };
}

function classify(
  versionMadeBy: number,
  externalAttributes: number,
  directorySuffix: boolean,
): CentralEntry['kind'] {
  if (versionMadeBy >>> 8 === 3) {
    const type = (externalAttributes >>> 16) & UNIX_TYPE_MASK;
    if (type === UNIX_SYMLINK) return 'symlink';
    if (type === UNIX_DIRECTORY) return 'directory';
    if (type === UNIX_REGULAR || type === 0) return directorySuffix ? 'directory' : 'file';
    return 'special';
  }
  return (externalAttributes & 0x10) !== 0 || directorySuffix ? 'directory' : 'file';
}

function assertFlags(flags: number): void {
  if ((flags & 0x0001) !== 0) fail('ENCRYPTION_NOT_ALLOWED', 'encrypted ZIP entry');
  if ((flags & 0x0008) !== 0) fail('DATA_DESCRIPTOR_NOT_ALLOWED', 'data descriptor ZIP entry');
  if (flags !== 0) fail('UNSUPPORTED_ZIP_FLAGS', `unsupported ZIP flags 0x${flags.toString(16)}`);
}

function assertNoOverlap(ranges: { start: number; end: number }[]): void {
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const current = ranges[index];
    const previous = ranges[index - 1];
    if (current && previous && current.start < previous.end) {
      fail('OVERLAPPING_ENTRIES', 'local ZIP entries overlap');
    }
  }
}

/** Every path and every parent directory must have one spelling, ignoring ASCII case. */
function assertNoCaseCollision(entryPath: string, spellings: Map<string, string>): void {
  const parts = entryPath.split('/');
  for (let length = 1; length <= parts.length; length += 1) {
    const prefix = parts.slice(0, length).join('/');
    const folded = prefix.toLowerCase();
    const known = spellings.get(folded);
    if (known !== undefined && known !== prefix) {
      fail('CASE_COLLISION', `${prefix} and ${known} differ only by case`);
    }
    spellings.set(folded, prefix);
  }
}

/** A regular file may not also be the parent directory of another entry. */
function assertNoTypeConflicts(
  allPaths: ReadonlySet<string>,
  filePaths: ReadonlySet<string>,
): void {
  for (const path of allPaths) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length += 1) {
      const parent = parts.slice(0, length).join('/');
      if (filePaths.has(parent)) {
        fail('PATH_TYPE_CONFLICT', `${parent} is a file but ${path} lies beneath it`);
      }
    }
  }
}

function expectSignature(archive: Buffer, offset: number, signature: number, label: string): void {
  ensureRange(archive, offset, 4, `${label} signature`);
  if (u32(archive, offset) !== signature) fail('INVALID_ZIP', `${label} signature is invalid`);
}

function ensureRange(archive: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > archive.length) {
    fail('INVALID_ZIP', `${label} exceeds archive bounds`);
  }
}

function u16(archive: Buffer, offset: number): number {
  ensureRange(archive, offset, 2, 'uint16');
  return archive.readUInt16LE(offset);
}

function u32(archive: Buffer, offset: number): number {
  ensureRange(archive, offset, 4, 'uint32');
  return archive.readUInt32LE(offset);
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
  let current = index;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(code: string, detail: string): never {
  throw new StoreArchiveError(code, detail);
}
