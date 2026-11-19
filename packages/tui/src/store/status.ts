/**
 * How a store describes itself to a person: a byte count they can judge, the age of a copy they
 * are being shown, and whether the last attempt failed because the store refused the index or
 * because the store could not be reached at all.
 */

/** A byte count in words: `67108864` becomes `64 MiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  const units = ['bytes', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
