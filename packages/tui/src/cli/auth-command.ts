import type { MavisRegion } from '@mavis/config';

import {
  loginWithOttiliApiKey,
  logoutOfOttiliApiKey,
  type OttiliApiKeyLoginOptions,
} from '../auth/ottili-api-key.js';
import type { TuiExternalTargetOpener } from '../host/open-external.js';

export interface RunTuiAuthCommandOptions
  extends Omit<OttiliApiKeyLoginOptions, 'openBrowser' | 'openExternalTarget'> {
  readonly region?: MavisRegion;
  readonly lane?: string;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
}

/**
 * Sign in to the Ottili AI Platform.
 *
 * Alran Code has no account of its own: the Ottili platform mints API keys, so
 * the browser opens on the key page and the pasted `sk-ottili-...` key is
 * stored in the local config.
 */
export async function runTuiLogin(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
  const result = await loginWithOttiliApiKey({
    ...(options.readApiKey ? { readApiKey: options.readApiKey } : {}),
    ...(options.storeKey ? { storeKey: options.storeKey } : {}),
    ...(options.consoleUrl ? { consoleUrl: options.consoleUrl } : {}),
    ...(options.openExternalTarget ? { openExternalTarget: options.openExternalTarget } : {}),
    openBrowser: options.openBrowser !== false,
    writeError,
  });
  return result.message;
}

/** Sign out by removing the stored Ottili API key. */
export async function runTuiLogout(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  return logoutOfOttiliApiKey({
    ...(options.clearKey ? { clearKey: options.clearKey } : {}),
  });
}
