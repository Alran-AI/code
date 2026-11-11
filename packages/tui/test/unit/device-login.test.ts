import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runTuiLogin } from '../../src/cli/auth-command.js';
import {
  DEVICE_GRANT_TYPE,
  DeviceLoginError,
  formatDeviceInstructions,
  runDeviceAuthorization,
  shouldUseDeviceFlow,
} from '../../src/cli/device-login.js';

const GATEWAY = 'https://ai.example/v1';
const START = {
  device_code: 'd'.repeat(43),
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://ai.example/device',
  verification_uri_complete: 'https://ai.example/device?user_code=BCDF-GHJK',
  expires_in: 600,
  interval: 5,
};
const SESSION = {
  session_id: 'sess_abcdefghijklmnopqrstuv',
  company_id: 'co_test',
  subject_id: 'sub_test',
  platform_base_url: 'https://platform.example',
};

type Reply = { status: number; body: unknown } | Error;

/** A gateway that answers from a script and remembers what it was asked. */
function gateway(replies: Reply[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request to ${String(url)}`);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const clock = () => {
  let time = 1_000_000;
  const waited: number[] = [];
  return {
    waited,
    sleep: async (milliseconds: number) => {
      waited.push(milliseconds);
      time += milliseconds;
    },
    now: () => time,
  };
};

const pending = { status: 400, body: { error: 'authorization_pending', interval: 5 } };

describe('the device authorization of the terminal', () => {
  it('shows the code, waits while it is pending, slows down when told to, and returns the session', async () => {
    const written: string[] = [];
    const g = gateway([
      { status: 200, body: START },
      pending,
      { status: 400, body: { error: 'slow_down', interval: 10 } },
      pending,
      { status: 200, body: SESSION },
    ]);
    const c = clock();

    const session = await runDeviceAuthorization({
      gatewayBaseUrl: `${GATEWAY}/`,
      write: (text) => written.push(text),
      fetchImpl: g.fetchImpl,
      sleep: c.sleep,
      now: c.now,
      deviceName: 'build-box',
    });

    expect(session).toEqual({
      sessionId: SESSION.session_id,
      companyId: 'co_test',
      subjectId: 'sub_test',
      baseUrl: 'https://platform.example',
    });
    expect(g.calls[0]).toEqual({ url: `${GATEWAY}/auth/device`, body: { client: 'alran-code', device_name: 'build-box' } });
    expect(g.calls[1]).toEqual({ url: `${GATEWAY}/auth/device/token`, body: { grant_type: DEVICE_GRANT_TYPE, device_code: START.device_code } });
    // 5 s before the first two polls (pending, then slow_down); 10 s before the next two, as the
    // service asked.
    expect(c.waited).toEqual([5000, 5000, 10_000, 10_000]);
    const text = written.join('');
    expect(text).toContain('https://ai.example/device');
    expect(text).toContain('BCDF-GHJK');
    expect(text).toContain('https://ai.example/device?user_code=BCDF-GHJK');
    expect(text).toContain('10 minutes');
  });

  it('adds five seconds when slow_down names no interval', async () => {
    const g = gateway([{ status: 200, body: START }, { status: 400, body: { error: 'slow_down' } }, { status: 200, body: SESSION }]);
    const c = clock();
    await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: g.fetchImpl, sleep: c.sleep, now: c.now });
    expect(c.waited).toEqual([5000, 10_000]);
  });

  it.each([
    ['access_denied', 'denied', /cancelled in the browser/u],
    ['expired_token', 'expired', /expired/u],
  ] as const)('ends with %s as %s', async (error, code, message) => {
    const g = gateway([{ status: 200, body: START }, { status: 400, body: { error } }]);
    const c = clock();
    const failure = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: g.fetchImpl, sleep: c.sleep, now: c.now }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect((failure as DeviceLoginError).code).toBe(code);
    expect((failure as DeviceLoginError).message).toMatch(message);
  });

  it('stops when the code has run out, without asking again', async () => {
    const g = gateway([{ status: 200, body: { ...START, expires_in: 10 } }, pending, pending, pending]);
    const c = clock();
    const failure = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: g.fetchImpl, sleep: c.sleep, now: c.now }).catch((e: unknown) => e);
    expect((failure as DeviceLoginError).code).toBe('expired');
    expect(g.calls.length).toBeLessThanOrEqual(3);
  });

  it('survives a dropped poll and gives up after four in a row', async () => {
    const lost = new TypeError('fetch failed');
    const recovered = gateway([{ status: 200, body: START }, lost, lost, { status: 200, body: SESSION }]);
    const c = clock();
    await expect(
      runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: recovered.fetchImpl, sleep: c.sleep, now: c.now }),
    ).resolves.toMatchObject({ companyId: 'co_test' });

    const gone = gateway([{ status: 200, body: START }, lost, lost, lost, lost]);
    const failure = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: gone.fetchImpl, sleep: clock().sleep, now: clock().now }).catch((e: unknown) => e);
    expect((failure as DeviceLoginError).code).toBe('unavailable');
  });

  it('says what to do when the platform has no device sign-in, is unreachable, or rate limits', async () => {
    const notThere = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: gateway([{ status: 404, body: {} }]).fetchImpl }).catch((e: unknown) => e);
    expect((notThere as DeviceLoginError).code).toBe('refused');
    expect((notThere as DeviceLoginError).message).toContain('--no-device');

    const down = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: gateway([new TypeError('fetch failed')]).fetchImpl }).catch((e: unknown) => e);
    expect((down as DeviceLoginError).code).toBe('unavailable');
    expect((down as DeviceLoginError).message).toContain(GATEWAY);

    const limited = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: gateway([{ status: 429, body: {} }]).fetchImpl }).catch((e: unknown) => e);
    expect((limited as DeviceLoginError).code).toBe('unavailable');
  });

  it('refuses answers that cannot be used instead of storing half a session', async () => {
    const noCode = await runDeviceAuthorization({ gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: gateway([{ status: 200, body: { user_code: 'X' } }]).fetchImpl }).catch((e: unknown) => e);
    expect((noCode as DeviceLoginError).code).toBe('refused');

    const c = clock();
    const halfSession = await runDeviceAuthorization({
      gatewayBaseUrl: GATEWAY, write: () => {}, sleep: c.sleep, now: c.now,
      fetchImpl: gateway([{ status: 200, body: START }, { status: 200, body: { session_id: 'sess_x' } }]).fetchImpl,
    }).catch((e: unknown) => e);
    expect((halfSession as DeviceLoginError).code).toBe('refused');
  });

  it('can be cancelled', async () => {
    const abort = new AbortController();
    const g = gateway([{ status: 200, body: START }]);
    const failure = await runDeviceAuthorization({
      gatewayBaseUrl: GATEWAY, write: () => {}, fetchImpl: g.fetchImpl, signal: abort.signal,
      sleep: async () => { abort.abort(new Error('interrupted')); throw new Error('aborted'); },
    }).catch((e: unknown) => e);
    expect((failure as DeviceLoginError).code).toBe('aborted');
  });
});

describe('when a terminal signs in with a code instead of a browser', () => {
  it.each([
    [{}, 'darwin', false],
    [{ DISPLAY: ':0' }, 'linux', false],
    [{ WAYLAND_DISPLAY: 'wayland-0' }, 'linux', false],
    [{}, 'linux', true],
    [{ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22', DISPLAY: ':0' }, 'linux', true],
    [{ SSH_TTY: '/dev/pts/0' }, 'darwin', true],
    [{ ALRAN_LOGIN_FLOW: 'device', DISPLAY: ':0' }, 'linux', true],
    [{ ALRAN_LOGIN_FLOW: 'browser', SSH_CONNECTION: 'x' }, 'linux', false],
  ] as const)('%j on %s: %s', (environment, platform, expected) => {
    expect(shouldUseDeviceFlow(environment as NodeJS.ProcessEnv, platform as NodeJS.Platform)).toBe(expected);
  });

  it('prints the address and the code in a way that can be read to someone else', () => {
    const text = formatDeviceInstructions({ user_code: 'BCDF-GHJK', verification_uri: 'https://ai.example/device', expires_in: 600 });
    expect(text).toContain('open this page in a browser on any device');
    expect(text).toContain('BCDF-GHJK');
  });
});

describe('alran auth login with a device code', () => {
  const roots: string[] = [];
  const saved = process.env.ALRAN_DATA_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALRAN_DATA_DIR;
    else process.env.ALRAN_DATA_DIR = saved;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('stores the session where the runtime reads it, owner-only, and says it signed in', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'alran-device-login-'));
    roots.push(root);
    process.env.ALRAN_DATA_DIR = root;
    const g = gateway([{ status: 200, body: START }, { status: 200, body: SESSION }]);
    const c = clock();
    const written: string[] = [];

    const message = await runTuiLogin({
      provider: 'platform',
      platformEnv: 'prod',
      device: true,
      writeError: (text) => written.push(text),
      deviceAuthorization: { fetchImpl: g.fetchImpl, sleep: c.sleep, now: c.now, gatewayBaseUrl: GATEWAY },
    });

    expect(message).toContain('with a device code');
    expect(written.join('')).toContain('BCDF-GHJK');
    const file = path.join(root, 'auth', 'platform', 'prod', 'platform-session.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      sessionId: SESSION.session_id,
      companyId: 'co_test',
      subjectId: 'sub_test',
      baseUrl: 'https://platform.example',
    });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('stores nothing when the person cancels', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'alran-device-login-'));
    roots.push(root);
    process.env.ALRAN_DATA_DIR = root;
    const g = gateway([{ status: 200, body: START }, { status: 400, body: { error: 'access_denied' } }]);
    const c = clock();

    await expect(
      runTuiLogin({
        provider: 'platform', platformEnv: 'prod', device: true, writeError: () => {},
        deviceAuthorization: { fetchImpl: g.fetchImpl, sleep: c.sleep, now: c.now, gatewayBaseUrl: GATEWAY },
      }),
    ).rejects.toMatchObject({ code: 'denied' });
    expect(() => statSync(path.join(root, 'auth', 'platform', 'prod', 'platform-session.json'))).toThrow();
  });
});
