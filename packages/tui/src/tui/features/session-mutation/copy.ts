import {
  SESSION_HISTORY_COPY,
  SESSION_MUTATION_COPY,
  type SessionHistoryCopyKey,
  type SessionMutationCopyKey,
} from './copy.en.js';

export type { SessionHistoryCopyKey } from './copy.en.js';

export function sessionMutationLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

export function sessionHistoryText(
  key: SessionHistoryCopyKey,
  _locale = sessionMutationLocale(),
): string {
  return SESSION_HISTORY_COPY[key];
}

export function sessionMutationText(
  key: SessionMutationCopyKey,
  _locale = sessionMutationLocale(),
): string {
  return SESSION_MUTATION_COPY[key];
}

export function sessionMutationTemplate(
  key: SessionMutationCopyKey,
  values: Readonly<Record<string, string | number>>,
  locale = sessionMutationLocale(),
): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    sessionMutationText(key, locale),
  );
}
