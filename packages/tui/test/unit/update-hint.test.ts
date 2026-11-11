import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveUpdateHint, UPDATE_CHECK_INTERVAL_MS } from '../../src/update/update-hint.js';

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(path.join(tmpdir(), 'alran-hint-')); });
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

const registry = (latest: string) => vi.fn(async () => new Response(JSON.stringify({ 'dist-tags': { latest } }), { status: 200 }));

describe('the weekly update hint', () => {
  it('asks the npm registry once a week and names the newer version', async () => {
    const fetchImpl = registry('1.1.0');
    const options = { currentVersion: '1.0.0', dataDir, environment: {}, fetchImpl: fetchImpl as unknown as typeof fetch };
    expect(await resolveUpdateHint({ ...options, now: () => 1_000 })).toBe('Alran Code 1.1.0 is available (you have 1.0.0). Run `alran update`.');
    expect(await resolveUpdateHint({ ...options, now: () => 2_000 })).toContain('1.1.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await resolveUpdateHint({ ...options, now: () => 1_000 + UPDATE_CHECK_INTERVAL_MS });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://registry.npmjs.org/alran');
  });

  it('says nothing when current, when switched off, in CI, or when the registry is unreachable', async () => {
    expect(await resolveUpdateHint({ currentVersion: '1.1.0', dataDir, environment: {}, fetchImpl: registry('1.1.0') as unknown as typeof fetch })).toBeNull();
    const fetchImpl = registry('9.9.9');
    expect(await resolveUpdateHint({ currentVersion: '1.0.0', dataDir, environment: { ALRAN_NO_UPDATE_CHECK: '1' }, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(await resolveUpdateHint({ currentVersion: '1.0.0', dataDir, environment: { CI: 'true' }, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await resolveUpdateHint({ currentVersion: '1.0.0', dataDir: path.join(dataDir, 'x'), environment: {}, fetchImpl: offline as unknown as typeof fetch })).toBeNull();
  });
});
