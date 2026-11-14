import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildProcessEnv } from '../src/runtime/transport/stdio.js';

afterEach(() => vi.unstubAllEnvs());

describe('MCP stdio server environment', () => {
  it('inherits the user environment but not the Alran account key', () => {
    vi.stubEnv('ALRAN_API_KEY', 'sk-ottili-synthetic');
    vi.stubEnv('GITHUB_TOKEN', 'synthetic-github-value');
    const env = buildProcessEnv();
    expect(env).not.toHaveProperty('ALRAN_API_KEY');
    expect(env.GITHUB_TOKEN).toBe('synthetic-github-value');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('gives a server the key only when its own configuration names it', () => {
    vi.stubEnv('ALRAN_API_KEY', 'sk-ottili-synthetic');
    expect(buildProcessEnv({ ALRAN_API_KEY: 'sk-ottili-for-this-server' }).ALRAN_API_KEY).toBe('sk-ottili-for-this-server');
    expect(buildProcessEnv(undefined, { ALRAN_API_KEY: 'sk-injected' }).ALRAN_API_KEY).toBe('sk-injected');
  });
});
