import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalEditTool } from '../desktop/local-pi-tools.js';

// "你好 world\n" in GBK, and "héllo world\n" in Latin-1: neither is valid UTF-8.
const GBK = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x0a]);
const LATIN1 = Buffer.from([0x68, 0xe9, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x0a]);
// UTF-16LE with a byte order mark.
const UTF16LE = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello world\n', 'utf16le')]);

describe('edit on files that are not UTF-8', () => {
  let directory: string;
  let file: string;
  const ctx = { sessionId: 'encoding-session', turnId: 'encoding-turn' };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edit-encoding-'));
    file = join(directory, 'legacy.txt');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe.each([false, true])('with replace_all=%s', (replaceAll) => {
    it.each([
      ['GBK', GBK],
      ['Latin-1', LATIN1],
      ['UTF-16LE', UTF16LE],
    ])('refuses a %s file and leaves its bytes unchanged', async (_name, bytes) => {
      await writeFile(file, bytes);

      await expect(
        new LocalEditTool(directory).execute(ctx, {
          file_path: 'legacy.txt',
          old_string: UTF16LE === bytes ? 'h\u0000' : 'world',
          new_string: 'earth',
          replace_all: replaceAll,
        }),
      ).rejects.toThrow(/not valid UTF-8/u);

      expect((await readFile(file)).equals(bytes)).toBe(true);
    });
  });

  it('still edits a UTF-8 file with multi-byte characters', async () => {
    await writeFile(file, '你好 world\n', 'utf8');

    await new LocalEditTool(directory).execute(ctx, {
      file_path: 'legacy.txt',
      old_string: 'world',
      new_string: 'earth',
    });

    expect(await readFile(file, 'utf8')).toBe('你好 earth\n');
  });
});
