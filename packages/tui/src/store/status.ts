import type { StoreErrorCode } from './contract.js';

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

/** How old a cached copy is: `3 days old`. */
export function formatCopyAge(fetchedAtMs: number, now: number = Date.now()): string {
  const age = Math.max(0, now - fetchedAtMs);
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'less than a minute old';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} old`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} old`;
}

/** The day a copy was fetched: `2026-11-18`. */
export function formatCopyDate(fetchedAtMs: number): string {
  return new Date(fetchedAtMs).toISOString().slice(0, 10);
}

/**
 * What went wrong with a source. A source that answered but whose answer was refused (too large,
 * not a valid index) was `rejected`; a source that could not be asked at all was `unreachable`.
 */
export function storeFailureKind(code: StoreErrorCode | undefined): 'rejected' | 'unreachable' {
  return code === 'SOURCE_REJECTED' || code === 'INDEX_INVALID' ? 'rejected' : 'unreachable';
}
