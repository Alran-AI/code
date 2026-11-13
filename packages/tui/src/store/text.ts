/**
 * Text from a store or from a package archive is written by someone else. Control characters in
 * it (an ANSI escape that rewrites the line above, a bidi override that reorders what follows)
 * could make a terminal show something other than what was approved, so they are replaced by a
 * visible `\u{…}` escape the moment the text enters the Store.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu;

export function escapeControl(text: string): string {
  return text.replace(UNSAFE, (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`);
}

/** Collapses whitespace runs (including newlines) so a value stays on one line. */
export function oneLine(text: string): string {
  return escapeControl(text.replace(/\s+/gu, ' ').trim());
}
