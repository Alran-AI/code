import { COMPOSER_COPY, type ComposerCopyKey } from './copy.en.js';

export function composerText(key: ComposerCopyKey, _locale?: string): string {
  return COMPOSER_COPY[key];
}
