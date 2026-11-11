import { EN_RUNTIME_TRANSLATIONS, type RuntimeTranslationKey } from './en.js';

const DEFAULT_RUNTIME_LOCALE = 'en';

/** Extract the canonical language subtag from a BCP 47 locale. */
export function getRuntimeLocaleLanguage(locale?: string | null): string {
  const candidate = locale?.trim().replace(/_/gu, '-');
  if (!candidate) return DEFAULT_RUNTIME_LOCALE;

  try {
    return new Intl.Locale(candidate).language.toLowerCase();
  } catch {
    return candidate.split('-')[0]?.toLowerCase() || DEFAULT_RUNTIME_LOCALE;
  }
}

/** Runtime text is English; the locale argument is accepted for callers that pass one. */
export function translateRuntimeText(
  _locale: string | null | undefined,
  key: RuntimeTranslationKey,
): string {
  return EN_RUNTIME_TRANSLATIONS[key];
}

export type { RuntimeTranslationKey } from './en.js';
