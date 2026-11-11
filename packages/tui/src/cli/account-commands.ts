// The account commands: who you are, which company and project you work in, what you have spent,
// what you can buy with it, and which model you use.
//
//   alran auth login | logout | status | switch-company
//   alran config company | project | model
//   alran usage
//   alran billing
//   alran models [--third-party] [--info <model>] [--set-default <model>]
//
// Every number comes from where it lives: the Ottili Platform (identity, companies, projects,
// wallet, billing) or the Ottili AI Gateway (`GET /v1/credits`, which applies the same credit rule
// the gateway enforces). The CLI decides nothing about money; what it says about credits is advisory.
//
// Exit codes (also documented in docs/AUTH.md):
//   0 success · 1 any other failure · 2 sign-in needed · 3 rate limited · 4 service unreachable ·
//   5 the credit does not allow it (no credit, or partner model on free credit only)
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';

import {
  ALRAN_MODELS,
  ALRAN_MODEL_TO_GATEWAY_ID,
  clearStoredPlatformSession,
  getConfig,
  isPaidOnlyOttiliModel,
  platformEnvironmentOrder,
  readOttiliAccountPreferences,
  resolveOttiliCatalogModelId,
  resolveOttiliGatewayBaseUrl,
  resolvePlatformEnvironmentForBuild,
  resolveStoredPlatformSession,
  updateLocalModelSelection,
  writeOttiliProjectPreference,
  writeStoredPlatformSession,
  type PlatformEnvironment,
  type StoredPlatformSession,
} from '@alran/config';
// The data directory of the running CLI (ALRAN_DATA_DIR, else the profile's default): the same one
// the model resolver reads the session from, so a sign-in is found where it is used.
import { getTuiDataDirPath } from '../runtime/data-dir.js';

export const ACCOUNT_EXIT = Object.freeze({
  ok: 0,
  error: 1,
  authRequired: 2,
  rateLimited: 3,
  unreachable: 4,
  credits: 5,
});

export class AlranAccountError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AlranAccountError';
  }
}

/** Everything the commands touch outside themselves, so a test can replace it. */
export interface AccountCommandIo {
  readonly dataDir: string;
  readonly platformEnv: PlatformEnvironment;
  readonly environment: NodeJS.ProcessEnv;
  readonly fetchImpl: typeof fetch;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly now: () => Date;
  /** The interactive Platform sign-in (OIDC in the browser); returns the message to print. */
  readonly login: (options: { openBrowser: boolean; apiKey: boolean }) => Promise<string>;
  /** Remove every local credential (session files and a stored API key). */
  readonly clearLocalCredentials: () => Promise<void>;
  /** Persist the default model (`provider/model`). */
  readonly setDefaultModel: (modelKey: string) => Promise<void>;
  /** The persisted default model (`provider/model`), if any. */
  readonly readDefaultModel: () => string | undefined;
}

export function defaultAccountCommandIo(): AccountCommandIo {
  return {
    dataDir: getTuiDataDirPath(),
    platformEnv: resolvePlatformEnvironmentForBuild(),
    environment: process.env,
    fetchImpl: fetch,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    now: () => new Date(),
    login: async ({ openBrowser, apiKey }) => {
      const { runTuiLogin } = await import('./auth-command.js');
      return runTuiLogin({ openBrowser, provider: apiKey ? 'api-key' : 'platform' });
    },
    clearLocalCredentials: async () => {
      const { runTuiLogout } = await import('./auth-command.js');
      await runTuiLogout({});
    },
    setDefaultModel: async (modelKey) => {
      await updateLocalModelSelection({ modelKey });
    },
    readDefaultModel: () => {
      try {
        return getConfig().defaultModel;
      } catch {
        return undefined;
      }
    },
  };
}

// --- Transport ---------------------------------------------------------------------------------------

interface CallOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly idempotent?: boolean;
}

function requireSession(io: AccountCommandIo): StoredPlatformSession {
  const session = resolveStoredPlatformSession(io.dataDir, io.platformEnv);
  if (!session) {
    throw new AlranAccountError('Not signed in. Run `alran auth login` first.', ACCOUNT_EXIT.authRequired, 'not_signed_in');
  }
  return session;
}

function platformBase(session: StoredPlatformSession, io: AccountCommandIo): string {
  const configured = io.environment.OTTILI_PLATFORM_URL?.trim();
  return (session.baseUrl || configured || 'https://platform.ottili.one').replace(/\/+$/u, '');
}

function gatewayBase(io: AccountCommandIo, session: StoredPlatformSession): string {
  return resolveOttiliGatewayBaseUrl(session.platformEnv, io.environment).replace(/\/+$/u, '');
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A refusal in the words a person can act on, with the exit code the shell can branch on. */
function refusal(status: number, body: Record<string, unknown>, service: string, retryAfter: string | null): AlranAccountError {
  const error = (body.error && typeof body.error === 'object' ? body.error : body) as Record<string, unknown>;
  const code = String(error.code ?? error.detail ?? '');
  const message = typeof error.message === 'string' ? error.message : typeof error.title === 'string' ? error.title : '';
  if (status === 401) {
    return new AlranAccountError('Your session has ended. Run `alran auth login` to sign in again.', ACCOUNT_EXIT.authRequired, code || 'unauthenticated');
  }
  if (status === 429) {
    const wait = retryAfter ? ` Try again in ${retryAfter} s.` : '';
    return new AlranAccountError(`${service} is rate limiting this account.${wait}`, ACCOUNT_EXIT.rateLimited, code || 'rate_limited');
  }
  if (status === 402 || code === 'free_credit_model_restricted' || code === 'insufficient_quota') {
    return new AlranAccountError(message || 'Your credit does not cover this request. Add credits in the Ottili AI Platform.', ACCOUNT_EXIT.credits, code);
  }
  if (status >= 500) {
    return new AlranAccountError(`${service} is not reachable right now (HTTP ${status}). Try again in a moment.`, ACCOUNT_EXIT.unreachable, code || 'unavailable');
  }
  return new AlranAccountError(`${service} refused the request (HTTP ${status}${code ? `, ${code}` : ''})${message ? `: ${message}` : '.'}`, ACCOUNT_EXIT.error, code);
}

async function send(io: AccountCommandIo, url: URL, init: RequestInit, service: string): Promise<Response> {
  try {
    return await io.fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AlranAccountError(
      `${service} is not reachable (${url.host}). Check your network connection and try again.`,
      ACCOUNT_EXIT.unreachable,
      'network_error',
    );
  }
}

/** A Platform call with the stored session; answers the envelope's `data`. */
export async function platformCall<T = Record<string, unknown>>(
  io: AccountCommandIo,
  session: StoredPlatformSession,
  path: string,
  options: CallOptions = {},
): Promise<T> {
  const url = new URL(path, `${platformBase(session, io)}/`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-ottili-session': session.sessionId,
    ...(session.companyId ? { 'x-ottili-company': session.companyId } : {}),
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(options.idempotent ? { 'idempotency-key': `alran-cli-${randomUUID()}` } : {}),
  };
  const response = await send(io, url, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  }, 'The Ottili Platform');
  const body = await readJson(response);
  if (!response.ok) throw refusal(response.status, body, 'The Ottili Platform', response.headers.get('retry-after'));
  return ((body.data ?? body) as T);
}

/** A gateway call with the stored session as bearer credential. */
export async function gatewayCall<T = Record<string, unknown>>(
  io: AccountCommandIo,
  session: StoredPlatformSession,
  path: string,
): Promise<T> {
  const url = new URL(`${gatewayBase(io, session)}${path}`);
  const project = session.companyId ? readOttiliAccountPreferences(io.dataDir).projects[session.companyId] : undefined;
  const response = await send(io, url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${session.sessionId}`,
      ...(session.companyId ? { 'x-ottili-company': session.companyId } : {}),
      ...(project ? { 'x-ottili-project': project } : {}),
    },
  }, 'The Ottili AI Gateway');
  const body = await readJson(response);
  if (!response.ok) throw refusal(response.status, body, 'The Ottili AI Gateway', response.headers.get('retry-after'));
  return body as T;
}

// --- Formatting --------------------------------------------------------------------------------------

/** micro-USD → "$12.34" (cents) or "$0.0042" (below a cent, four places). */
export function formatMicroUsd(micro: number): string {
  const value = Number(micro) / 1_000_000;
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${value < 0 ? '-' : ''}$${abs.toFixed(digits)}`;
}

/** minor units of a currency → "12.34 USD". */
function formatMinor(amount: unknown): string {
  const record = (amount && typeof amount === 'object' ? amount : {}) as Record<string, unknown>;
  const minor = Number(record.amount_minor);
  if (!Number.isFinite(minor)) return '—';
  return `${(minor / 100).toFixed(2)} ${String(record.currency ?? 'USD').toUpperCase()}`;
}

/** A plain table: columns padded to their widest cell, two spaces apart. */
export function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((cell, index) => (cell ?? '').padEnd(widths[index]!)).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '─'.repeat(width))), ...rows.map(line)].join('\n');
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

// --- auth ----------------------------------------------------------------------------------------------

interface ProfileAnswer { readonly profile?: { readonly display_name?: string; readonly subject_id?: string } }
interface CompaniesAnswer { readonly companies?: readonly { readonly company_id: string; readonly slug?: string; readonly status?: string; readonly roles?: readonly string[] }[] }

async function whoAmI(io: AccountCommandIo, session: StoredPlatformSession) {
  const [profile, session_] = await Promise.all([
    platformCall<ProfileAnswer>(io, session, '/v2/profile'),
    platformCall<Record<string, unknown>>(io, session, `/v2/auth/sessions/${encodeURIComponent(session.sessionId)}`).catch((error: unknown) => {
      if (error instanceof AlranAccountError && error.exitCode === ACCOUNT_EXIT.authRequired) throw error;
      return {} as Record<string, unknown>;
    }),
  ]);
  return {
    name: profile.profile?.display_name || profile.profile?.subject_id || session.subjectId || 'unknown',
    subjectId: profile.profile?.subject_id || session.subjectId,
    expiresAt: typeof session_.expires_at === 'string' ? session_.expires_at : null,
  };
}

export async function runAuthStatus(io: AccountCommandIo, options: { json?: boolean } = {}): Promise<void> {
  const session = resolveStoredPlatformSession(io.dataDir, io.platformEnv);
  if (!session) {
    if (options.json) io.out(json({ signed_in: false }));
    else io.out('Not signed in. Run `alran auth login` to connect Alran Code to your Ottili account.\n');
    throw new AlranAccountError('', ACCOUNT_EXIT.authRequired, 'not_signed_in');
  }
  const me = await whoAmI(io, session);
  const project = readOttiliAccountPreferences(io.dataDir).projects[session.companyId] ?? null;
  const status = {
    signed_in: true,
    name: me.name,
    subject_id: me.subjectId,
    company_id: session.companyId,
    project_id: project,
    environment: session.platformEnv === 'prod' ? 'production' : 'development',
    platform: platformBase(session, io),
    gateway: gatewayBase(io, session),
    session_expires_at: me.expiresAt,
    default_model: io.readDefaultModel() ?? 'alran/Alran-Werk',
  };
  if (options.json) {
    io.out(json(status));
    return;
  }
  io.out([
    `Signed in as ${status.name}`,
    `  Company   ${status.company_id}`,
    `  Project   ${status.project_id ?? 'default project of the company'}`,
    `  Model     ${status.default_model}`,
    `  Platform  ${status.platform} (${status.environment})`,
    `  Gateway   ${status.gateway}`,
    ...(status.session_expires_at ? [`  Session   valid until ${status.session_expires_at}`] : []),
    '',
  ].join('\n'));
}

export async function runAuthLogin(
  io: AccountCommandIo,
  options: { force?: boolean; browser?: boolean; apiKey?: boolean } = {},
): Promise<void> {
  const existing = resolveStoredPlatformSession(io.dataDir, io.platformEnv);
  if (existing && !options.force && !options.apiKey) {
    try {
      const me = await whoAmI(io, existing);
      io.out(`Already logged in as ${me.name} (company ${existing.companyId}). Use \`alran auth login --force\` to sign in again.\n`);
      return;
    } catch (error) {
      // A session that no longer works is replaced by a new sign-in; any other failure is reported.
      if (!(error instanceof AlranAccountError) || error.exitCode !== ACCOUNT_EXIT.authRequired) throw error;
    }
  }
  io.out(`${await io.login({ openBrowser: options.browser !== false, apiKey: options.apiKey === true })}\n`);
}

export async function runAuthLogout(io: AccountCommandIo): Promise<void> {
  // Revoke every stored session at the Platform first, then remove the local files: a session that
  // only disappears locally would keep working for whoever copied it.
  const warnings: string[] = [];
  for (const platformEnv of platformEnvironmentOrder(io.platformEnv)) {
    const session = resolveStoredPlatformSession(io.dataDir, platformEnv);
    if (!session || session.platformEnv !== platformEnv) continue;
    try {
      await platformCall(io, session, `/v2/auth/sessions/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE', idempotent: true });
    } catch (error) {
      // An already-ended session is the goal; an unreachable Platform must not keep you signed in.
      if (!(error instanceof AlranAccountError) || error.exitCode !== ACCOUNT_EXIT.authRequired) {
        warnings.push(`Could not revoke the ${platformEnv} session at the Platform (${error instanceof Error ? error.message : String(error)}); it was removed from this machine and expires on its own.`);
      }
    }
    clearStoredPlatformSession(io.dataDir, platformEnv);
  }
  await io.clearLocalCredentials();
  for (const warning of warnings) io.err(`${warning}\n`);
  io.out('Logged out.\n');
}

export async function runSwitchCompany(io: AccountCommandIo, target: string | undefined, options: { json?: boolean } = {}): Promise<void> {
  const session = requireSession(io);
  const answer = await platformCall<CompaniesAnswer>(io, session, '/v2/companies');
  const companies = answer.companies ?? [];
  if (!target) {
    if (options.json) {
      io.out(json({ current: session.companyId, companies }));
      return;
    }
    if (companies.length === 0) {
      io.out('Your account is not a member of a company yet. Create or join one in the Ottili Console.\n');
      return;
    }
    io.out(`${formatTable(['', 'Company', 'Slug', 'Roles'], companies.map((company) => [
      company.company_id === session.companyId ? '*' : '',
      company.company_id,
      company.slug ?? '',
      (company.roles ?? []).join(', '),
    ]))}\n\nSwitch with \`alran auth switch-company <company id or slug>\`.\n`);
    return;
  }
  const chosen = companies.find((company) => company.company_id === target || company.slug === target);
  if (!chosen) {
    throw new AlranAccountError(`You are not a member of a company "${target}". Run \`alran auth switch-company\` to list yours.`, ACCOUNT_EXIT.error, 'company_not_found');
  }
  if (chosen.company_id === session.companyId) {
    io.out(`Already working in ${chosen.slug ?? chosen.company_id}.\n`);
    return;
  }
  const switched = await platformCall<{ session?: { session_id?: string; company_id?: string } }>(io, session, '/v2/auth/company', {
    method: 'POST',
    body: { company_id: chosen.company_id },
    idempotent: true,
  });
  writeStoredPlatformSession(io.dataDir, session.platformEnv, {
    sessionId: switched.session?.session_id || session.sessionId,
    companyId: switched.session?.company_id || chosen.company_id,
    subjectId: session.subjectId,
    baseUrl: session.baseUrl,
  }, { via: 'oidc' });
  io.out(`Switched to ${chosen.slug ?? chosen.company_id}. Model calls, usage and billing now use this company.\n`);
}

// --- config project / model ----------------------------------------------------------------------------

interface ProjectsAnswer { readonly items?: readonly { readonly project_id: string; readonly name?: string; readonly status?: string; readonly access?: { readonly role?: string } }[] }

export async function runConfigProject(io: AccountCommandIo, target: string | undefined, options: { clear?: boolean; json?: boolean } = {}): Promise<void> {
  const session = requireSession(io);
  const current = readOttiliAccountPreferences(io.dataDir).projects[session.companyId] ?? null;
  if (options.clear) {
    writeOttiliProjectPreference(io.dataDir, session.companyId, null);
    io.out('Project cleared: requests use the default project of the company.\n');
    return;
  }
  let answer: ProjectsAnswer;
  try {
    answer = await platformCall<ProjectsAnswer>(io, session, '/v2/projects', { query: { status: 'active', member: 'me', limit: '200' } });
  } catch (error) {
    // A Platform release without shared projects answers 404 for the route itself.
    if (error instanceof AlranAccountError && /HTTP 404/u.test(error.message)) {
      throw new AlranAccountError('This Ottili Platform does not offer projects yet; requests use the default project of the company.', ACCOUNT_EXIT.error, 'projects_unavailable');
    }
    throw error;
  }
  const projects = answer.items ?? [];
  if (!target) {
    if (options.json) {
      io.out(json({ current, projects }));
      return;
    }
    if (projects.length === 0) {
      io.out('No projects you can use in this company. Requests use the default project.\n');
      return;
    }
    io.out(`${formatTable(['', 'Project', 'Name', 'Your role'], projects.map((project) => [
      project.project_id === current ? '*' : '',
      project.project_id,
      project.name ?? '',
      project.access?.role ?? '',
    ]))}\n\n${current ? '' : 'No project chosen: requests use the default project.\n'}Choose one with \`alran config project <project id or name>\`.\n`);
    return;
  }
  const chosen = projects.find((project) => project.project_id === target || project.name === target);
  if (!chosen) {
    throw new AlranAccountError(`No active project "${target}" that you are a member of. Run \`alran config project\` to list them.`, ACCOUNT_EXIT.error, 'project_not_found');
  }
  writeOttiliProjectPreference(io.dataDir, session.companyId, chosen.project_id);
  io.out(`Project set to ${chosen.name ?? chosen.project_id}. Model calls are attributed to it from now on.\n`);
}

/** The catalog model key (`provider/model`) of a name a person typed, or undefined. */
export function modelKeyOf(name: string): string | undefined {
  const id = resolveOttiliCatalogModelId(name.replace(/^(alran|external)\//u, ''));
  if (!Object.hasOwn(ALRAN_MODELS, id)) return undefined;
  return `alran/${id}`;
}

interface CreditsAnswer {
  readonly currency?: string;
  readonly balance_microcents?: number;
  readonly available_microcents?: number;
  readonly reserved_microcents?: number;
  readonly free_credit?: { readonly granted_microcents?: number; readonly remaining_microcents?: number };
  readonly paid_credit?: { readonly available_microcents?: number };
  readonly models?: readonly { readonly id: string; readonly usable?: boolean; readonly reason?: string | null; readonly credit_class?: string; readonly service_fee_bps?: number }[];
  readonly current_month?: {
    readonly from?: string;
    readonly by_model?: readonly { readonly model: string; readonly requests: number; readonly input_tokens?: number; readonly output_tokens?: number; readonly cost_microcents: number; readonly service_fee_microcents?: number }[];
    readonly total_cost_microcents?: number;
    readonly total_service_fee_microcents?: number;
  };
}

/** Credits as the gateway sees them, or null when they cannot be read (not signed in, offline). */
async function creditsIfAvailable(io: AccountCommandIo, session: StoredPlatformSession | null): Promise<CreditsAnswer | null> {
  if (!session) return null;
  try {
    return await gatewayCall<CreditsAnswer>(io, session, '/credits');
  } catch {
    return null;
  }
}

export async function runConfigModel(io: AccountCommandIo, target: string | undefined): Promise<void> {
  if (!target) {
    io.out(`${io.readDefaultModel() ?? 'alran/Alran-Werk'}\n`);
    return;
  }
  const key = modelKeyOf(target);
  if (!key) {
    throw new AlranAccountError(`Unknown model "${target}". Run \`alran models\` to list the models.`, ACCOUNT_EXIT.error, 'model_not_found');
  }
  await io.setDefaultModel(key);
  io.out(`Default model set to ${ALRAN_MODELS[key.slice(key.indexOf('/') + 1)]?.name ?? key} (${key}).\n`);
  if (isPaidOnlyOttiliModel(key.slice(key.indexOf('/') + 1))) {
    const credits = await creditsIfAvailable(io, resolveStoredPlatformSession(io.dataDir, io.platformEnv));
    const model = credits?.models?.find((entry) => entry.id === ALRAN_MODEL_TO_GATEWAY_ID[key.slice(key.indexOf('/') + 1)]);
    if (model && model.usable === false) {
      io.err('Note: this model uses purchased credits only. Your current credit is welcome credit, which covers Werk. Add credits in the Ottili AI Platform to use it.\n');
    }
  }
}

// --- models ----------------------------------------------------------------------------------------------

/** The Ottili models with their list prices, for a listing that works signed out and offline too. */
export const OTTILI_MODEL_LISTING = Object.freeze([
  { key: 'alran/Alran-Werk', id: 'ottili/werk-1.1', short: 'werk', name: 'Ottili Werk 1.1', input: 500_000, output: 1_500_000, feeBps: 0, credit: 'welcome or purchased credit', description: 'Ottili’s own model for coding and agentic work. Default.' },
  { key: 'alran/anthropic/claude-sonnet-5.5', id: 'anthropic/claude-sonnet-5.5', short: 'sonnet', name: 'Claude Sonnet 5.5', input: 2_000_000, output: 10_000_000, feeBps: 450, credit: 'purchased credit', description: 'Anthropic’s everyday model for coding and agents.' },
  { key: 'alran/anthropic/claude-opus-5.5', id: 'anthropic/claude-opus-5.5', short: 'opus', name: 'Claude Opus 5.5', input: 4_000_000, output: 20_000_000, feeBps: 450, credit: 'purchased credit', description: 'Anthropic’s most capable Opus model for hard, long tasks.' },
]);

function availability(model: (typeof OTTILI_MODEL_LISTING)[number], credits: CreditsAnswer | null): string {
  if (!credits) return 'sign in to check';
  const entry = credits.models?.find((candidate) => candidate.id === model.id);
  if (!entry) return 'not offered right now';
  if (entry.usable) return 'available';
  return entry.reason === 'requires_paid_credit' ? 'requires purchased credit' : 'no credit left';
}

export async function runModels(
  io: AccountCommandIo,
  options: { thirdParty?: boolean; info?: string; setDefault?: string; json?: boolean } = {},
): Promise<void> {
  if (options.setDefault) {
    await runConfigModel(io, options.setDefault);
    return;
  }
  if (options.thirdParty) {
    io.out([
      'Third-party providers (bring your own key)',
      '',
      'Alran Code can call another provider directly with your own API key. Ottili does not see,',
      'meter or bill those requests; the provider bills you. Configure one with:',
      '',
      '  alran provider add --name <name> --base-url <url> --api-format openai-completions \\',
      '    --model <model id> --api-key-env <ENV_VAR_WITH_YOUR_KEY> --use',
      '',
      'Supported formats: openai-completions, openai-responses, anthropic-messages. `alran provider`',
      'opens the provider picker with the bundled catalog of known providers; `alran provider list`',
      'shows what you configured. See docs/MODELS.md.',
      '',
    ].join('\n'));
    return;
  }
  const session = resolveStoredPlatformSession(io.dataDir, io.platformEnv);
  const credits = await creditsIfAvailable(io, session);
  const current = io.readDefaultModel() ?? 'alran/Alran-Werk';
  if (options.info) {
    const key = modelKeyOf(options.info);
    const model = OTTILI_MODEL_LISTING.find((entry) => entry.key === key);
    if (!model) throw new AlranAccountError(`Unknown model "${options.info}". Run \`alran models\` to list the models.`, ACCOUNT_EXIT.error, 'model_not_found');
    const catalog = ALRAN_MODELS[model.key.slice(model.key.indexOf('/') + 1)];
    const info = {
      id: model.id,
      name: model.name,
      short_name: model.short,
      description: model.description,
      context_tokens: catalog?.limit?.context ?? null,
      max_output_tokens: catalog?.limit?.output ?? null,
      price_per_million_tokens: { input: formatMicroUsd(model.input), output: formatMicroUsd(model.output) },
      service_fee: model.feeBps ? `${model.feeBps / 100} % of the token cost, shown as its own line` : null,
      paid_with: model.credit,
      status: availability(model, credits),
    };
    if (options.json) io.out(json(info));
    else io.out(`${Object.entries(info).filter(([, value]) => value !== null).map(([field, value]) => `${field.padEnd(18)} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('\n')}\n`);
    return;
  }
  if (options.json) {
    io.out(json(OTTILI_MODEL_LISTING.map((model) => ({ ...model, status: availability(model, credits), default: model.key === current }))));
    return;
  }
  io.out(`${formatTable(['', 'Model', 'Name', 'Input / output per 1M tokens', 'Paid with', 'Status'], OTTILI_MODEL_LISTING.map((model) => [
    model.key === current ? '*' : '',
    model.short,
    model.name,
    `${formatMicroUsd(model.input)} / ${formatMicroUsd(model.output)}`,
    model.credit,
    availability(model, credits),
  ]))}

Claude models are billed at Anthropic's token prices plus a 4.5 % service fee, listed as its own line
per request. Change the default with \`alran models --set-default <model>\`; details with
\`alran models --info <model>\`; your own providers with \`alran models --third-party\`.
`);
}

// --- usage and billing -------------------------------------------------------------------------------------

export async function runUsage(io: AccountCommandIo, options: { json?: boolean } = {}): Promise<void> {
  const session = requireSession(io);
  const credits = await gatewayCall<CreditsAnswer>(io, session, '/credits');
  if (options.json) {
    io.out(json(credits));
    return;
  }
  const month = credits.current_month;
  const rows = (month?.by_model ?? []).map((row) => [
    row.model,
    String(row.requests),
    String((row.input_tokens ?? 0) + (row.output_tokens ?? 0)),
    formatMicroUsd(row.cost_microcents - (row.service_fee_microcents ?? 0)),
    row.service_fee_microcents ? formatMicroUsd(row.service_fee_microcents) : '—',
    formatMicroUsd(row.cost_microcents),
  ]);
  io.out([
    `Credits (${String(credits.currency ?? 'USD').toUpperCase()})`,
    `  Available        ${formatMicroUsd(credits.available_microcents ?? 0)}`,
    `  Reserved         ${formatMicroUsd(credits.reserved_microcents ?? 0)}`,
    `  Welcome credit   ${formatMicroUsd(credits.free_credit?.remaining_microcents ?? 0)} left of ${formatMicroUsd(credits.free_credit?.granted_microcents ?? 0)} (Werk only)`,
    `  Purchased credit ${formatMicroUsd(credits.paid_credit?.available_microcents ?? 0)} (all models)`,
    '',
    `This month (since ${month?.from?.slice(0, 10) ?? '—'})`,
    rows.length > 0
      ? formatTable(['Model', 'Requests', 'Tokens', 'Token cost', 'Service fee', 'Total'], rows)
      : '  No requests yet.',
    '',
    `Total this month: ${formatMicroUsd(month?.total_cost_microcents ?? 0)}`,
    '',
  ].join('\n'));
}

interface BillingPieces {
  subscription: Record<string, unknown> | null;
  paymentMethods: readonly Record<string, unknown>[];
  invoices: readonly Record<string, unknown>[];
  welcome: Record<string, unknown> | null;
}

export async function runBilling(io: AccountCommandIo, options: { json?: boolean } = {}): Promise<void> {
  const session = requireSession(io);
  const optional = async <T>(promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof AlranAccountError && error.exitCode === ACCOUNT_EXIT.authRequired) throw error;
      return null;
    }
  };
  const [subscription, methods, invoices, welcome] = await Promise.all([
    optional(platformCall<{ subscription?: Record<string, unknown> }>(io, session, '/v2/billing/subscription')),
    optional(platformCall<{ payment_methods?: Record<string, unknown>[] }>(io, session, '/v2/billing/payment-methods')),
    optional(platformCall<{ invoices?: Record<string, unknown>[] }>(io, session, '/v2/billing/invoices', { query: { limit: '1' } })),
    optional(platformCall<{ welcome_credit?: Record<string, unknown> }>(io, session, '/v2/billing/welcome-credit')),
  ]);
  const pieces: BillingPieces = {
    subscription: subscription?.subscription ?? null,
    paymentMethods: methods?.payment_methods ?? [],
    invoices: invoices?.invoices ?? [],
    welcome: welcome?.welcome_credit ?? null,
  };
  const billingPage = `${gatewayBase(io, session).replace(/\/v1$/u, '')}/billing`;
  if (options.json) {
    // Payment methods by their display label only: no card data exists on this side, and none is printed.
    io.out(json({
      plan: pieces.subscription ? String(pieces.subscription.plan_id ?? 'pay-per-use') : 'pay-per-use',
      payment_methods: pieces.paymentMethods.map((method) => ({ label: method.display_label ?? null, default: method.is_default === true, state: method.state ?? null })),
      last_invoice: pieces.invoices[0] ?? null,
      welcome_credit: pieces.welcome ? { state: pieces.welcome.state ?? null } : null,
      manage_at: billingPage,
    }));
    return;
  }
  const method = pieces.paymentMethods.find((entry) => entry.is_default === true) ?? pieces.paymentMethods[0];
  const invoice = pieces.invoices[0];
  io.out([
    `Plan             ${pieces.subscription ? String(pieces.subscription.plan_id ?? 'Pay-per-use') : 'Pay-per-use (prepaid credits)'}`,
    `Payment method   ${method ? String(method.display_label ?? 'on file') : 'none on file'}`,
    `Last invoice     ${invoice ? `${formatMinor(invoice.amount)} · ${String(invoice.state ?? '')} · ${String(invoice.issued_at ?? '').slice(0, 10)}` : 'none yet'}`,
    `Next billing     ${pieces.subscription && pieces.subscription.state === 'active' ? 'with your subscription period' : 'none: credits are prepaid, nothing is billed automatically'}`,
    `Welcome credit   ${pieces.welcome ? String(pieces.welcome.state ?? 'unknown').replaceAll('_', ' ') : 'not available'}`,
    '',
    `Add credits, change the payment method or download invoices: ${billingPage}`,
    '',
  ].join('\n'));
}

// --- Registration ----------------------------------------------------------------------------------------

/** Run a command and turn its refusal into a message on stderr and an exit code. */
export async function runAccountAction(io: AccountCommandIo, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AlranAccountError) {
      if (error.message) io.err(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

export function registerAccountCommands(
  program: Command,
  makeIo: () => AccountCommandIo = defaultAccountCommandIo,
  version?: string,
): void {
  const run = (action: (io: AccountCommandIo) => Promise<void>) => async () => {
    const io = makeIo();
    // The weekly update hint runs beside the command and is given at most a moment after it.
    const hint = version
      ? import('../update/update-hint.js').then(({ resolveUpdateHint }) =>
          resolveUpdateHint({ currentVersion: version, dataDir: io.dataDir, environment: io.environment, fetchImpl: io.fetchImpl }),
        ).catch(() => null)
      : Promise.resolve(null);
    await runAccountAction(io, () => action(io));
    const text = await Promise.race([hint, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500).unref())]);
    if (text) io.err(`${text}\n`);
  };

  const auth = program.command('auth').description('Sign in to your Ottili account, check it, switch company, sign out');
  auth
    .command('login')
    .description('Sign in with your Ottili account in the browser')
    .option('--force', 'sign in again even when a session exists')
    .option('--no-browser', 'print the sign-in page URL without opening a browser')
    .option('--api-key', 'paste an Ottili API key instead (for machines without a browser)')
    .action((options: { force?: boolean; browser?: boolean; apiKey?: boolean }) => run((io) => runAuthLogin(io, options))());
  auth
    .command('logout')
    .description('Revoke the session at the Ottili Platform and remove local credentials')
    .action(() => run(runAuthLogout)());
  auth
    .command('status')
    .description('Who you are signed in as, and which company, project and model you use')
    .option('--json', 'print a JSON document')
    .action((options: { json?: boolean }) => run((io) => runAuthStatus(io, options))());
  auth
    .command('switch-company')
    .description('List your companies, or switch to one')
    .argument('[company]', 'company id or slug')
    .option('--json', 'print a JSON document')
    .action((company: string | undefined, options: { json?: boolean }) => run((io) => runSwitchCompany(io, company, options))());

  const config = program.command('config').description('Show or set the company, project and model Alran Code works with');
  config
    .command('company')
    .description('Show your companies, or switch to one')
    .argument('[company]', 'company id or slug')
    .option('--json', 'print a JSON document')
    .action((company: string | undefined, options: { json?: boolean }) => run((io) => runSwitchCompany(io, company, options))());
  config
    .command('project')
    .description('Show your projects, or choose the one model calls are attributed to')
    .argument('[project]', 'project id or name')
    .option('--clear', 'go back to the default project of the company')
    .option('--json', 'print a JSON document')
    .action((project: string | undefined, options: { clear?: boolean; json?: boolean }) => run((io) => runConfigProject(io, project, options))());
  config
    .command('model')
    .description('Show or set the default model (werk, sonnet, opus or a full id)')
    .argument('[model]', 'model')
    .action((model: string | undefined) => run((io) => runConfigModel(io, model))());

  program
    .command('models')
    .description('List the Ottili models, their prices and whether your credit covers them')
    .option('--third-party', 'how to use another provider with your own API key')
    .option('--info <model>', 'details of one model')
    .option('--set-default <model>', 'make a model the default')
    .option('--list', 'list the models (the default)')
    .option('--json', 'print a JSON document')
    .action((options: { thirdParty?: boolean; info?: string; setDefault?: string; json?: boolean }) => run((io) => runModels(io, options))());

  program
    .command('usage')
    .description('Credits left and this month\'s spend per model')
    .option('--json', 'print a JSON document')
    .action((options: { json?: boolean }) => run((io) => runUsage(io, options))());

  program
    .command('billing')
    .description('Plan, payment method, last invoice, and where to manage billing')
    .option('--json', 'print a JSON document')
    .action((options: { json?: boolean }) => run((io) => runBilling(io, options))());
}
