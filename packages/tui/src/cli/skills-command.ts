import type { AlranSkillCliRequest } from '../plugin/contract.js';
import { AlranStoreApplication } from '../store/application.js';
import { prepareTuiDataDir } from '../runtime/data-dir.js';
import {
  createTerminalHost,
  installItem,
  listItems,
  removeItem,
  searchStore,
  showItem,
  updateItems,
  type StoreCliHost,
} from './store-cli.js';

export interface RunAlranSkillCommandOptions {
  readonly request: AlranSkillCliRequest;
  /** Tests supply a host; the command line uses the terminal. */
  readonly host?: StoreCliHost;
  readonly dataDir?: string;
}

/**
 * `alran skills …`. Skills are plain folders in the data directory, so nothing here starts the
 * Runtime: the command is as quick as the network, and a running Alran picks the folder up on
 * its next session or `/reload`.
 */
export async function runAlranSkillCommand(options: RunAlranSkillCommandOptions): Promise<string> {
  const host =
    options.host ??
    createTerminalHost(new AlranStoreApplication({ dataDir: options.dataDir ?? (await prepareTuiDataDir()) }));
  const request = options.request;
  switch (request.action) {
    case 'list':
      return listItems(host, 'skill', { installed: request.installed, json: request.json });
    case 'search':
      return searchStore(host, 'skill', request);
    case 'info':
      return showItem(host, 'skill', request.selector, request.json);
    case 'add':
      return installItem(host, 'skill', request.selector, request);
    case 'update':
      return updateItems(host, 'skill', request);
    case 'remove':
      return removeItem(host, 'skill', request.selector, request.json);
  }
}
