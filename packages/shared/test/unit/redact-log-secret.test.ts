import { describe, expect, it } from 'vitest';

import { REDACTED, isSecretKey, redactSecretValue } from '../../src/logging/redact-log-secret.js';

describe('credential field names', () => {
  it.each([
    'GITHUB_TOKEN',
    'MATRIX_TOKEN',
    'botToken',
    'token',
    'x-auth-token',
    'access_token',
    'refreshToken',
    'password',
    'OPENAI_API_KEY',
  ])('treats %s as a credential', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each([
    'max_tokens',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'context_usage',
    'tokens',
    'tokens_per_second',
    'model',
  ])('keeps the accounting field %s readable', (key) => {
    expect(isSecretKey(key)).toBe(false);
  });
});

describe('structured redaction', () => {
  it('removes a vendor-named token from an environment snapshot and keeps the accounting', () => {
    const redacted = redactSecretValue({
      env: { GITHUB_TOKEN: 'ghp_exampleexampleexample', PATH: '/usr/bin' },
      usage: { input_tokens: 120, output_tokens: 48 },
    });
    expect(redacted.env.GITHUB_TOKEN).toBe(REDACTED);
    expect(redacted.env.PATH).toBe('/usr/bin');
    expect(redacted.usage).toEqual({ input_tokens: 120, output_tokens: 48 });
  });
});
