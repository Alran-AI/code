import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  currentRefreshOwner,
  isRefreshOwnerAlive,
  type ProcessStartProbe,
} from '../../src/refresh-owner.js';

afterEach(() => vi.restoreAllMocks());

/** A platform that cannot say when a process started: only absence is evidence. */
const unknownStart: ProcessStartProbe = { processStartMs: () => undefined };

describe('refresh owner identity', () => {
  it('distinguishes the current process from an earlier process with the same PID', () => {
    const owner = currentRefreshOwner();
    expect(isRefreshOwnerAlive(owner)).toBe(true);
    expect(isRefreshOwnerAlive({ ...owner, startedAtMs: owner.startedAtMs - 1_000 })).toBe(false);
  });

  it.each(['ESRCH', 'EPERM', 'EACCES'])(
    'only treats a foreign PID as dead on ESRCH (probe=%s)',
    (code) => {
      const owner = { ...currentRefreshOwner(), pid: process.pid + 1 };
      vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('probe failed'), { code }); });
      expect(isRefreshOwnerAlive(owner, unknownStart)).toBe(code !== 'ESRCH');
    },
  );

  it('keeps a live foreign PID or an older fence with no owner recoverable', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(isRefreshOwnerAlive({ ...currentRefreshOwner(), pid: process.pid + 1 }, unknownStart)).toBe(true);
    expect(isRefreshOwnerAlive(undefined)).toBe(true);
  });
});

describe('a recycled PID', () => {
  const fence = { pid: 4242, startedAtMs: 1_800_000_000_000 };

  it('does not keep a dead owner alive: the PID is held by a process that started later', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const laterProcess: ProcessStartProbe = { processStartMs: () => fence.startedAtMs + 3_600_000 };
    expect(isRefreshOwnerAlive(fence, laterProcess)).toBe(false);
  });

  it.each([
    ['the same instant', 0],
    ['a start the kernel and Node measure differently', 900],
    ['the edge of the margin', 5_000],
    ['earlier than the fence (cannot be a recycled holder)', -86_400_000],
  ])('keeps a live owner alive: %s', (_label, offsetMs) => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const probe: ProcessStartProbe = { processStartMs: () => fence.startedAtMs + offsetMs };
    expect(isRefreshOwnerAlive(fence, probe)).toBe(true);
  });

  it('judges a process it may not signal by its start time too', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    const laterProcess: ProcessStartProbe = { processStartMs: () => fence.startedAtMs + 60_000 };
    expect(isRefreshOwnerAlive(fence, laterProcess)).toBe(false);
  });

  it.runIf(process.platform === 'linux')('reads the start time of a real process from procfs', () => {
    // PID 1 started at boot: a fence that claims it started in 1970 names a different process,
    // one that claims it started a second ago names a process that is plausibly still the owner.
    expect(isRefreshOwnerAlive({ pid: 1, startedAtMs: 0 })).toBe(false);
    expect(isRefreshOwnerAlive({ pid: 1, startedAtMs: Date.now() })).toBe(true);
  });
});
