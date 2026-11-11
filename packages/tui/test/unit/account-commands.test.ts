import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  platformSessionPath,
  readOttiliAccountPreferences,
  ottiliAccountPreferencesPath,
  writeStoredPlatformSession,
} from '@alran/config';

import {
  ACCOUNT_EXIT,
  AlranAccountError,
  formatMicroUsd,
  modelKeyOf,
  runAccountAction,
  runAuthLogin,
  runAuthLogout,
  runAuthStatus,
  runConfigModel,
  runConfigProject,
  runModels,
  runSwitchCompany,
  runUsage,
  type AccountCommandIo,
} from '../../src/cli/account-commands.js';

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

const envelope = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ schema_version: 'ottili.envelope/v1', data }), { status, headers: { 'content-type': 'application/json' } });
const plain = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let dataDir: string;
let out: string[];
let err: string[];
let calls: { method: string; url: string; headers: Record<string, string> }[];

function io(routes: Record<string, Route>, overrides: Partial<AccountCommandIo> = {}): AccountCommandIo {
  return {
    dataDir,
    platformEnv: 'prod',
    environment: { ALRAN_API_BASE: 'https://ai.example.invalid/v1' },
    fetchImpl: (async (input: URL | RequestInfo, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      calls.push({ method, url: url.toString(), headers: (init.headers ?? {}) as Record<string, string> });
      const route = routes[`${method} ${url.pathname}`];
      if (!route) return plain({ error: { code: 'not_found' } }, 404);
      return route(url, init);
    }) as typeof fetch,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    now: () => new Date('2026-11-11T12:00:00Z'),
    login: vi.fn(async () => 'Signed in to the Ottili AI Platform (production).'),
    clearLocalCredentials: vi.fn(async () => undefined),
    setDefaultModel: vi.fn(async () => undefined),
    readDefaultModel: () => 'alran/Alran-Werk',
    ...overrides,
  };
}

function signIn(companyId = 'co_A') {
  writeStoredPlatformSession(dataDir, 'prod', {
    sessionId: 'sess_1',
    companyId,
    subjectId: 'usr_1',
    baseUrl: 'https://platform.example.invalid',
  }, { via: 'oidc' });
}

const PROFILE: Route = () => envelope({ profile: { subject_id: 'usr_1', display_name: 'Ada Lovelace' } });
const SESSION: Route = () => envelope({ session_id: 'sess_1', expires_at: '2026-12-11T00:00:00Z' });

const CREDITS = (overrides: Record<string, unknown> = {}): Route => () => plain({
  object: 'credits',
  currency: 'USD',
  balance_microcents: 10_000_000,
  available_microcents: 10_000_000,
  reserved_microcents: 0,
  free_credit: { granted_microcents: 10_000_000, remaining_microcents: 10_000_000 },
  paid_credit: { available_microcents: 0 },
  models: [
    { id: 'ottili/werk-1.1', usable: true, reason: null, credit_class: 'included', service_fee_bps: 0 },
    { id: 'anthropic/claude-sonnet-5.5', usable: false, reason: 'requires_paid_credit', credit_class: 'paid_only', service_fee_bps: 450 },
    { id: 'anthropic/claude-opus-5.5', usable: false, reason: 'requires_paid_credit', credit_class: 'paid_only', service_fee_bps: 450 },
  ],
  current_month: {
    from: '2026-11-01T00:00:00.000Z',
    by_model: [
      { model: 'anthropic/claude-sonnet-5.5', requests: 2, input_tokens: 100, output_tokens: 50, cost_microcents: 1045, service_fee_microcents: 45 },
      { model: 'ottili/werk-1.1', requests: 5, input_tokens: 900, output_tokens: 300, cost_microcents: 900, service_fee_microcents: 0 },
    ],
    total_cost_microcents: 1945,
    total_service_fee_microcents: 45,
  },
  ...overrides,
});

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'alran-account-'));
  out = [];
  err = [];
  calls = [];
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('auth status', () => {
  it('says how to sign in and exits 2 when no session is stored', async () => {
    const commandIo = io({});
    await runAccountAction(commandIo, () => runAuthStatus(commandIo));
    expect(out.join('')).toContain('Not signed in. Run `alran auth login`');
    expect(process.exitCode).toBe(ACCOUNT_EXIT.authRequired);
  });

  it('names the person, company, project and model, and sends the session to the Platform', async () => {
    signIn();
    const commandIo = io({ 'GET /v2/profile': PROFILE, 'GET /v2/auth/sessions/sess_1': SESSION });
    await runAuthStatus(commandIo);
    const text = out.join('');
    expect(text).toContain('Signed in as Ada Lovelace');
    expect(text).toContain('Company   co_A');
    expect(text).toContain('default project of the company');
    expect(text).toContain('valid until 2026-12-11');
    expect(calls[0]!.headers['x-ottili-session']).toBe('sess_1');
    expect(calls[0]!.headers['x-ottili-company']).toBe('co_A');
  });
});

describe('auth login', () => {
  it('does not sign in again when the stored session still works', async () => {
    signIn();
    const commandIo = io({ 'GET /v2/profile': PROFILE, 'GET /v2/auth/sessions/sess_1': SESSION });
    await runAuthLogin(commandIo);
    expect(out.join('')).toContain('Already logged in as Ada Lovelace (company co_A)');
    expect(commandIo.login).not.toHaveBeenCalled();
  });

  it('signs in again with --force, and when the stored session has ended', async () => {
    signIn();
    const forced = io({ 'GET /v2/profile': PROFILE });
    await runAuthLogin(forced, { force: true });
    expect(forced.login).toHaveBeenCalledWith({ openBrowser: true, apiKey: false });

    const ended = io({ 'GET /v2/profile': () => envelope({}, 401) });
    await runAuthLogin(ended, { browser: false });
    expect(ended.login).toHaveBeenCalledWith({ openBrowser: false, apiKey: false });
  });
});

describe('auth logout', () => {
  it('revokes the session at the Platform, then removes every local credential', async () => {
    signIn();
    const commandIo = io({ 'DELETE /v2/auth/sessions/sess_1': () => envelope({ session_id: 'sess_1', revoked: true }) });
    await runAuthLogout(commandIo);
    expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/v2/auth/sessions/sess_1'))).toBe(true);
    expect(existsSync(platformSessionPath(dataDir, 'prod'))).toBe(false);
    expect(commandIo.clearLocalCredentials).toHaveBeenCalled();
    expect(out.join('')).toBe('Logged out.\n');
  });

  it('still signs out on this machine when the Platform cannot be reached, and says so', async () => {
    signIn();
    const commandIo = io({}, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await runAuthLogout(commandIo);
    expect(existsSync(platformSessionPath(dataDir, 'prod'))).toBe(false);
    expect(err.join('')).toContain('Could not revoke the prod session');
    expect(out.join('')).toBe('Logged out.\n');
  });
});

describe('company and project', () => {
  const COMPANIES: Route = () => envelope({ companies: [
    { company_id: 'co_A', slug: 'acme', roles: ['owner'] },
    { company_id: 'co_B', slug: 'beta', roles: ['employee'] },
  ] });

  it('lists the companies with the current one marked, and switches by slug', async () => {
    signIn();
    const commandIo = io({
      'GET /v2/companies': COMPANIES,
      'POST /v2/auth/company': () => envelope({ session: { session_id: 'sess_1', company_id: 'co_B' } }),
    });
    await runSwitchCompany(commandIo, undefined);
    expect(out.join('')).toMatch(/\*\s+co_A\s+acme/u);
    await runSwitchCompany(commandIo, 'beta');
    const stored = JSON.parse(readFileSync(platformSessionPath(dataDir, 'prod'), 'utf8'));
    expect(stored.companyId).toBe('co_B');
    const post = calls.find((call) => call.method === 'POST')!;
    expect(post.headers['idempotency-key']).toMatch(/^alran-cli-/u);
  });

  it('refuses a company the account is not a member of', async () => {
    signIn();
    const commandIo = io({ 'GET /v2/companies': COMPANIES });
    await expect(runSwitchCompany(commandIo, 'gamma')).rejects.toBeInstanceOf(AlranAccountError);
  });

  it('remembers the project per company in an owner-only file', async () => {
    signIn();
    const commandIo = io({ 'GET /v2/projects': () => envelope({ items: [{ project_id: 'proj_1', name: 'Website', access: { role: 'member' } }] }) });
    await runConfigProject(commandIo, 'Website');
    expect(readOttiliAccountPreferences(dataDir).projects).toEqual({ co_A: 'proj_1' });
    if (process.platform !== 'win32') {
      expect(statSync(ottiliAccountPreferencesPath(dataDir)).mode & 0o777).toBe(0o600);
      expect(statSync(platformSessionPath(dataDir, 'prod')).mode & 0o777).toBe(0o600);
    }
    await runConfigProject(commandIo, undefined, { clear: true });
    expect(readOttiliAccountPreferences(dataDir).projects).toEqual({});
  });
});

describe('models', () => {
  it('lists the three Ottili models with prices and what the credit covers', async () => {
    signIn();
    const commandIo = io({ 'GET /v1/credits': CREDITS() });
    await runModels(commandIo);
    const text = out.join('');
    expect(text).toMatch(/\*\s+werk\s+Ottili Werk 1\.1\s+\$0\.50 \/ \$1\.50/u);
    expect(text).toMatch(/sonnet\s+Claude Sonnet 5\.5\s+\$2\.00 \/ \$10\.00\s+purchased credit\s+requires purchased credit/u);
    expect(text).toMatch(/opus\s+Claude Opus 5\.5\s+\$4\.00 \/ \$20\.00/u);
    expect(text).toContain('4.5 % service fee');
    const gateway = calls.find((call) => call.url.endsWith('/v1/credits'))!;
    expect(gateway.headers.authorization).toBe('Bearer sess_1');
  });

  it('works signed out, and points third-party use at bring-your-own-key', async () => {
    const commandIo = io({});
    await runModels(commandIo);
    expect(out.join('')).toContain('sign in to check');
    out.length = 0;
    await runModels(commandIo, { thirdParty: true });
    expect(out.join('')).toContain('Ottili does not see,\nmeter or bill those requests');
  });

  it('sets the default model by short name and warns when only welcome credit is left', async () => {
    signIn();
    const commandIo = io({ 'GET /v1/credits': CREDITS() });
    await runConfigModel(commandIo, 'sonnet');
    expect(commandIo.setDefaultModel).toHaveBeenCalledWith('alran/anthropic/claude-sonnet-5.5');
    expect(err.join('')).toContain('uses purchased credits only');
    expect(modelKeyOf('werk')).toBe('alran/Alran-Werk');
    expect(modelKeyOf('gpt-6')).toBeUndefined();
  });
});

describe('usage', () => {
  it('shows the welcome and the purchased credit and the month per model, fee as its own column', async () => {
    signIn();
    const commandIo = io({ 'GET /v1/credits': CREDITS() });
    await runUsage(commandIo);
    const text = out.join('');
    expect(text).toContain('Welcome credit   $10.00 left of $10.00 (Werk only)');
    expect(text).toContain('Purchased credit $0.00 (all models)');
    expect(text).toMatch(/anthropic\/claude-sonnet-5\.5\s+2\s+150\s+\$0\.0010\s+\$0\.0000|anthropic\/claude-sonnet-5\.5\s+2\s+150/u);
    expect(text).toContain('Service fee');
  });

  it('maps refusals to exit codes: rate limit 3, unreachable 4, credit 5, session ended 2', async () => {
    signIn();
    const cases: [Route, number][] = [
      [() => plain({ error: { code: 'rate_limit_exceeded' } }, 429, { 'retry-after': '7' }), ACCOUNT_EXIT.rateLimited],
      [() => plain({ error: { code: 'credit_service_unavailable' } }, 503), ACCOUNT_EXIT.unreachable],
      [() => plain({ error: { code: 'free_credit_model_restricted', message: 'Your free credits are restricted to Werk.' } }, 403), ACCOUNT_EXIT.credits],
      [() => plain({ error: { code: 'invalid_api_key' } }, 401), ACCOUNT_EXIT.authRequired],
    ];
    for (const [route, code] of cases) {
      process.exitCode = undefined;
      const commandIo = io({ 'GET /v1/credits': route });
      await runAccountAction(commandIo, () => runUsage(commandIo));
      expect(process.exitCode).toBe(code);
    }
    expect(err.join('')).toContain('Try again in 7 s.');
  });

  it('is exit 4 with a network hint when the gateway is unreachable', async () => {
    signIn();
    const commandIo = io({}, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await runAccountAction(commandIo, () => runUsage(commandIo));
    expect(process.exitCode).toBe(ACCOUNT_EXIT.unreachable);
    expect(err.join('')).toContain('Check your network connection');
  });
});

describe('formatting', () => {
  it('prints micro-USD as dollars, four places below a cent', () => {
    expect(formatMicroUsd(12_340_000)).toBe('$12.34');
    expect(formatMicroUsd(1045)).toBe('$0.0010');
    expect(formatMicroUsd(0)).toBe('$0.00');
  });
});

describe('model availability colours', () => {
  it('colours the status on a terminal and leaves it plain otherwise', async () => {
    const { colourAvailability } = await import('../../src/cli/account-commands.js');
    expect(colourAvailability({ environment: {} }, 'available', true)).toBe('\u001b[32mavailable\u001b[39m');
    expect(colourAvailability({ environment: {} }, 'requires purchased credit', true)).toContain('\u001b[33m');
    expect(colourAvailability({ environment: {} }, 'no credit left', true)).toContain('\u001b[31m');
    expect(colourAvailability({ environment: {} }, 'available', false)).toBe('available');
    expect(colourAvailability({ environment: { NO_COLOR: '1' } }, 'available', true)).toBe('available');
    expect(colourAvailability({ environment: { FORCE_COLOR: '1' } }, 'available', false)).toContain('\u001b[32m');
  });
});
