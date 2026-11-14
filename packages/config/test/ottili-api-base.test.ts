import { describe, expect, it } from 'vitest';

import { resolveOttiliApiBaseUrl } from '../src/ottili.js';

const resolve = (env: Record<string, string>) => resolveOttiliApiBaseUrl(env as NodeJS.ProcessEnv);

describe('ALRAN_API_BASE', () => {
  it('uses the public gateway when unset', () => {
    expect(resolve({})).toMatch(/^https:\/\//u);
  });

  it('accepts an https gateway and strips /chat/completions', () => {
    expect(resolve({ ALRAN_API_BASE: 'https://gateway.example/v1/chat/completions' })).toBe('https://gateway.example/v1');
    expect(resolve({ ALRAN_API_BASE: ' https://gateway.example/v1/ ' })).toBe('https://gateway.example/v1');
  });

  it('accepts plain http only for a loopback gateway', () => {
    expect(resolve({ ALRAN_API_BASE: 'http://127.0.0.1:18406/v1' })).toBe('http://127.0.0.1:18406/v1');
    expect(resolve({ ALRAN_API_BASE: 'http://localhost:18406/v1' })).toBe('http://localhost:18406/v1');
    expect(() => resolve({ ALRAN_API_BASE: 'http://attacker.example/v1' })).toThrow(/https/);
  });

  it('lets a trusted network opt in to plain http explicitly', () => {
    expect(resolve({ ALRAN_API_BASE: 'http://gateway.internal/v1', ALRAN_API_BASE_ALLOW_HTTP: '1' })).toBe('http://gateway.internal/v1');
    expect(() => resolve({ ALRAN_API_BASE: 'http://gateway.internal/v1', ALRAN_API_BASE_ALLOW_HTTP: 'true' })).toThrow(/https/);
  });

  it('refuses what is not a URL, other schemes and embedded credentials', () => {
    for (const bad of ['gateway.example/v1', 'ftp://gateway.example', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@gateway.example/v1', 'https://user@gateway.example/v1']) {
      expect(() => resolve({ ALRAN_API_BASE: bad }), bad).toThrow(/ALRAN_API_BASE/);
    }
  });
});
