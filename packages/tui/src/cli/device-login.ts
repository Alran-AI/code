// The device authorization of the Ottili AI Platform (RFC 8628), for a terminal that has no browser it
// can hand over to — an SSH session, a container, a machine without a display.
//
//   1. `POST <gateway>/auth/device`        -> a device code (secret, polled with) and a user code
//   2. the person opens the verification address in any browser and enters or confirms the code
//   3. `POST <gateway>/auth/device/token`  -> `authorization_pending` ... then a Platform session
//
// The session is the terminal's own: the browser signed in once more to create it, so signing out of
// the terminal does not sign the browser out. See docs/AUTH.md.
import { hostname } from 'node:os';

export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export type DeviceLoginFailure = 'expired' | 'denied' | 'unavailable' | 'refused' | 'aborted';

/** Why the device authorization ended without a session; `code` is stable for scripts and tests. */
export class DeviceLoginError extends Error {
  constructor(
    message: string,
    readonly code: DeviceLoginFailure,
  ) {
    super(message);
    this.name = 'DeviceLoginError';
  }
}

export interface DeviceLoginSession {
  readonly sessionId: string;
  readonly companyId: string;
  readonly subjectId: string;
  /** The Platform as the person's browser reaches it: where later Platform calls go. */
  readonly baseUrl: string;
}

export interface DeviceAuthorizationOptions {
  /** The gateway's base URL including `/v1` (`https://ai.ottili.one/v1`). */
  readonly gatewayBaseUrl: string;
  readonly write: (text: string) => void;
  readonly fetchImpl?: typeof fetch;
  /** Waits; rejects with the signal's reason when it aborts. Replaceable so tests need no clock. */
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly deviceName?: string;
  readonly signal?: AbortSignal;
}

interface DeviceStart {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete?: string;
  readonly expires_in: number;
  readonly interval: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_NETWORK_FAILURES = 4;
const MIN_INTERVAL_SECONDS = 1;

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Whether a terminal should use the device authorization instead of the loopback sign-in.
 *
 * The loopback sign-in opens a browser on this machine and waits for it to call back to
 * `127.0.0.1`. That cannot work over SSH (the browser is on another machine) or where there is no
 * display. `ALRAN_LOGIN_FLOW=device|browser` decides it for a script.
 */
export function shouldUseDeviceFlow(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const forced = environment.ALRAN_LOGIN_FLOW?.trim().toLowerCase();
  if (forced === 'device') return true;
  if (forced === 'browser') return false;
  if (environment.SSH_CONNECTION || environment.SSH_TTY || environment.SSH_CLIENT) return true;
  if (platform === 'linux' && !environment.DISPLAY && !environment.WAYLAND_DISPLAY) return true;
  return false;
}

/** The text printed for the person: where to go and what to enter. */
export function formatDeviceInstructions(start: Pick<DeviceStart, 'user_code' | 'verification_uri' | 'verification_uri_complete' | 'expires_in'>): string {
  const minutes = Math.max(1, Math.round(start.expires_in / 60));
  return [
    '',
    'To sign in, open this page in a browser on any device:',
    `  ${start.verification_uri}`,
    '',
    `and enter the code:  ${start.user_code}`,
    ...(start.verification_uri_complete ? ['', `or open it directly:  ${start.verification_uri_complete}`] : []),
    '',
    `The code is valid for ${minutes} minutes. Waiting for you to confirm… (Ctrl+C to cancel)`,
    '',
  ].join('\n');
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    // A non-JSON answer (a proxy's error page) is handled by its status below.
  }
  return { status: response.status, body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {} };
}

function parseStart(body: Record<string, unknown>): DeviceStart {
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '');
  const number = (key: string, fallback: number) => (typeof body[key] === 'number' && Number.isFinite(body[key]) ? (body[key] as number) : fallback);
  const start: DeviceStart = {
    device_code: text('device_code'),
    user_code: text('user_code'),
    verification_uri: text('verification_uri'),
    verification_uri_complete: text('verification_uri_complete') || undefined,
    expires_in: number('expires_in', 600),
    interval: Math.max(MIN_INTERVAL_SECONDS, number('interval', 5)),
  };
  if (!start.device_code || !start.user_code || !/^https?:\/\//u.test(start.verification_uri)) {
    throw new DeviceLoginError('The sign-in service answered without a device code.', 'refused');
  }
  return start;
}

function parseSession(body: Record<string, unknown>): DeviceLoginSession {
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const session = {
    sessionId: text('session_id'),
    companyId: text('company_id'),
    subjectId: text('subject_id'),
    baseUrl: text('platform_base_url').replace(/\/+$/u, ''),
  };
  if (!session.sessionId || !session.companyId || !session.subjectId || !/^https?:\/\//u.test(session.baseUrl)) {
    throw new DeviceLoginError('The sign-in service answered without a session.', 'refused');
  }
  return session;
}

/**
 * Ask for a code, show it, and wait until the person has answered.
 *
 * @throws {DeviceLoginError} `expired` (the code ran out), `denied` (the person said no),
 *   `unavailable` (the service cannot be reached), `refused` (it answered something unusable),
 *   `aborted` (Ctrl+C).
 */
export async function runDeviceAuthorization(options: DeviceAuthorizationOptions): Promise<DeviceLoginSession> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const base = options.gatewayBaseUrl.replace(/\/+$/u, '');

  let start: DeviceStart;
  try {
    const answer = await postJson(
      fetchImpl,
      `${base}/auth/device`,
      { client: 'alran-code', device_name: options.deviceName ?? safeHostname() },
      options.signal,
    );
    if (answer.status === 404) {
      throw new DeviceLoginError(
        'This Ottili AI Platform does not offer the device sign-in yet. Use `alran auth login --no-device`, or `alran auth login --api-key`.',
        'refused',
      );
    }
    if (answer.status === 429) throw new DeviceLoginError('Too many sign-in attempts. Wait a minute and try again.', 'unavailable');
    if (answer.status !== 200) throw new DeviceLoginError(`The sign-in service refused the request (HTTP ${answer.status}).`, 'refused');
    start = parseStart(answer.body);
  } catch (error) {
    if (error instanceof DeviceLoginError) throw error;
    if (options.signal?.aborted) throw new DeviceLoginError('Sign-in cancelled.', 'aborted');
    throw new DeviceLoginError(`Cannot reach the Ottili AI Platform at ${base}. Check the connection and try again.`, 'unavailable');
  }

  options.write(formatDeviceInstructions(start));

  const deadline = now() + start.expires_in * 1000;
  let interval = start.interval;
  let failures = 0;
  for (;;) {
    try {
      await sleep(interval * 1000, options.signal);
    } catch {
      throw new DeviceLoginError('Sign-in cancelled.', 'aborted');
    }
    if (now() > deadline) throw new DeviceLoginError('The code expired before it was confirmed. Run `alran auth login` again.', 'expired');
    let answer: { status: number; body: Record<string, unknown> };
    try {
      answer = await postJson(
        fetchImpl,
        `${base}/auth/device/token`,
        { grant_type: DEVICE_GRANT_TYPE, device_code: start.device_code },
        options.signal,
      );
      failures = 0;
    } catch {
      if (options.signal?.aborted) throw new DeviceLoginError('Sign-in cancelled.', 'aborted');
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
        throw new DeviceLoginError(`Lost the connection to the Ottili AI Platform at ${base}. Run \`alran auth login\` again.`, 'unavailable');
      }
      continue;
    }
    if (answer.status === 200) return parseSession(answer.body);
    const error = typeof answer.body.error === 'string' ? answer.body.error : '';
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      // RFC 8628 §3.5: wait longer from now on; the service says how long, else five seconds more.
      interval = typeof answer.body.interval === 'number' && answer.body.interval > interval ? answer.body.interval : interval + 5;
      continue;
    }
    if (error === 'access_denied') throw new DeviceLoginError('Sign-in was cancelled in the browser.', 'denied');
    if (error === 'expired_token') throw new DeviceLoginError('The code expired before it was confirmed. Run `alran auth login` again.', 'expired');
    if (answer.status === 429) {
      interval += 5;
      continue;
    }
    throw new DeviceLoginError(`The sign-in service answered with an error (${error || `HTTP ${answer.status}`}).`, 'refused');
  }
}

function safeHostname(): string {
  try {
    return hostname().slice(0, 64);
  } catch {
    return 'unknown device';
  }
}
