import { isUtf8 } from 'node:buffer';

/**
 * The edit tools work on text decoded as UTF-8 and write the whole file back
 * as UTF-8. For a file in another encoding (GBK, Shift-JIS, Latin-1, UTF-16)
 * that round trip replaces every byte it cannot decode with U+FFFD and
 * reports success, destroying content the edit never touched. Refuse the edit
 * instead, before anything is written.
 */
export function assertEditableUtf8(buffer: Buffer, displayPath: string): void {
  if (isUtf8(buffer)) return;
  throw new Error(
    `Could not edit file: ${displayPath}. The file is not valid UTF-8 (a legacy or UTF-16 encoding?), ` +
      'so an edit would replace its bytes with U+FFFD. The file was left unchanged; ' +
      'convert it to UTF-8 first if it should be edited.',
  );
}
