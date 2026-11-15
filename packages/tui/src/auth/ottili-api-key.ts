import { createInterface } from 'node:readline/promises';
import {
  cwd as processCwd,
  stderr as processStderr,
  stdin as processStdin,
  stdout as processStdout,
} from 'node:process';

import {
  isOttiliApiKey,
  OTTILI_API_KEY_PREFIX,
  resolveOttiliApiBaseUrl,
  resolveOttiliApiKeyConsoleUrl,
  updateLocalByokConfig,
} from '@alran/config';

import { createTuiExternalTargetOpener, type TuiExternalTargetOpener } from '../host/open-external.js';

export interface OttiliApiKeyStoreOptions {
  /** Persist the key. Replaces the default config-file write. */
  readonly storeKey?: (apiKey: string) => Promise<void>;
  /** Remove the stored key. Replaces the default config-file write. */
  readonly clearKey?: () => Promise<void>;
}

export interface OttiliApiKeyLoginOptions extends OttiliApiKeyStoreOptions {
  /** Open the Ottili API-key page in a browser. */
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  /** Read the key from the user. Replaces the default stdin prompt. */
  readonly readApiKey?: () => Promise<string>;
  readonly write?: (value: string) => void;
  readonly writeError?: (value: string) => void;
  /** Override the Ottili API-key page. */
  readonly consoleUrl?: string;
  /** Ask the AI Platform whether it accepts the key. Replaces the default `GET /v1/models`. */
  readonly verifyKey?: (apiKey: string) => Promise<OttiliApiKeyVerdict>;
}

/**
 * What the AI Platform said about a key.
 *
 *   verified    the gateway accepted the key (and said how many models it can use)
 *   rejected    the gateway refused it as invalid or revoked: nothing is saved
 *   unconfirmed the gateway could not say (down, unreachable, rate-limited, or a key that may not list models):
 *               the key is saved and the person is told it was not confirmed — never "Signed in" on a guess
 */
export type OttiliApiKeyVerdict =
  | { readonly kind: 'verified'; readonly models: number }
  | { readonly kind: 'rejected'; readonly detail: string }
  | { readonly kind: 'unconfirmed'; readonly detail: string };

/**
 * Check a key against the gateway with the cheapest authenticated call it has, `GET /v1/models`: it costs no
 * tokens, needs only the key, and answers 401 for a key it does not know. "Signed in" used to be said after the
 * key was merely typed in the right shape, so a revoked key or a platform that could not route anything was
 * discovered by the first model request (the founder's audit, §3.3).
 */
export async function verifyOttiliApiKey(
  apiKey: string,
  options: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number; readonly baseUrl?: string } = {},
): Promise<OttiliApiKeyVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let base: string;
  try {
    base = options.baseUrl ?? resolveOttiliApiBaseUrl();
  } catch (error) {
    return { kind: 'unconfirmed', detail: error instanceof Error ? error.message : String(error) };
  }
  try {
    const response = await fetchImpl(`${base.replace(/\/+$/u, '')}/models`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (response.status === 401) return { kind: 'rejected', detail: 'HTTP 401: invalid or revoked key' };
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
      return { kind: 'verified', models: Array.isArray(body?.data) ? body.data.length : 0 };
    }
    // 403 is a valid key without the scope to list models; 429/5xx is the platform being busy or down.
    return { kind: 'unconfirmed', detail: `HTTP ${response.status}` };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { kind: 'unconfirmed', detail: name === 'TimeoutError' ? 'no answer in time' : 'the platform could not be reached' };
  }
}

export interface OttiliApiKeyLoginResult {
  readonly message: string;
  readonly apiKey: string;
  readonly consoleUrl: string;
}

/** Store an Ottili API key in the local config, keeping it out of plain sight. */
export async function storeOttiliApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!isOttiliApiKey(trimmed)) {
    throw new Error(
      `Invalid Ottili API key: expected a key starting with "${OTTILI_API_KEY_PREFIX}".`,
    );
  }
  await updateLocalByokConfig((draft) => {
    draft.alran_api = { ...(draft.alran_api ?? {}), apiKey: trimmed };
    draft.alranModelSource = 'alran_api_key';
  });
}

/** Remove the stored Ottili API key from the local config. */
export async function clearOttiliApiKey(): Promise<void> {
  await updateLocalByokConfig((draft) => {
    if (!draft.alran_api) {
      draft.alranModelSource = undefined;
      return;
    }
    const rest = { ...draft.alran_api };
    delete rest.apiKey;
    draft.alran_api = Object.keys(rest).length > 0 ? rest : undefined;
    draft.alranModelSource = undefined;
  });
}

/** Read an API key from stdin, without echoing it back. */
async function promptForApiKey(
  write: (value: string) => void,
  writeError: (value: string) => void,
): Promise<string> {
  if (!processStdin.isTTY) {
    writeError('Reading the Ottili API key from stdin…\n');
    const chunks: Buffer[] = [];
    for await (const chunk of processStdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const rl = createInterface({ input: processStdin, output: processStdout, terminal: true });
  try {
    write('Paste your Ottili API key: ');
    const answer = await rl.question('');
    write('\n');
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * Sign in with an Ottili API key.
 *
 * The CLI does not own an account system: the Ottili platform mints API keys,
 * so the browser opens on the key page and the key the user pastes is stored
 * in the local config.
 */
export async function loginWithOttiliApiKey(
  options: OttiliApiKeyLoginOptions = {},
): Promise<OttiliApiKeyLoginResult> {
  const write = options.write ?? ((value: string) => processStdout.write(value));
  const writeError = options.writeError ?? ((value: string) => processStderr.write(value));
  const consoleUrl = options.consoleUrl ?? resolveOttiliApiKeyConsoleUrl();

  writeError(`Open this page to create an Ottili API key:\n${consoleUrl}\n`);
  if (options.openBrowser !== false) {
    const openExternalTarget =
      options.openExternalTarget ?? createTuiExternalTargetOpener(processCwd());
    try {
      await openExternalTarget(consoleUrl);
    } catch {
      writeError("Couldn't open the default browser. Open the URL above manually.\n");
    }
  }

  const apiKey = await (options.readApiKey ?? (() => promptForApiKey(write, writeError)))();
  if (!isOttiliApiKey(apiKey)) {
    throw new Error(
      `Invalid Ottili API key: expected a key starting with "${OTTILI_API_KEY_PREFIX}".`,
    );
  }

  const verdict = await (options.verifyKey ?? ((key: string) => verifyOttiliApiKey(key)))(apiKey);
  if (verdict.kind === 'rejected') {
    throw new Error(
      `The Ottili AI Platform rejected this API key (${verdict.detail}). Nothing was saved. Create a new key at ${consoleUrl}.`,
    );
  }

  await (options.storeKey ?? storeOttiliApiKey)(apiKey);
  return {
    apiKey,
    consoleUrl,
    message:
      verdict.kind === 'verified'
        ? `Signed in to the Ottili AI Platform with your Ottili API key. The platform accepted it${
            verdict.models > 0 ? ` (${verdict.models} model${verdict.models === 1 ? '' : 's'} available)` : ''
          }.`
        : `Your Ottili API key was saved, but the platform could not confirm it (${verdict.detail}). It is used for the next request; run \`alran status\` to see whether the platform answers.`,
  };
}

/** Sign out by removing the stored Ottili API key. */
export async function logoutOfOttiliApiKey(
  options: OttiliApiKeyStoreOptions = {},
): Promise<string> {
  await (options.clearKey ?? clearOttiliApiKey)();
  return 'Signed out of the Ottili AI Platform. The stored API key was removed.';
}
