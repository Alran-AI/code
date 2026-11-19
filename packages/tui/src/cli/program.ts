import { resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import type { AlranRegion } from '@alran/config';
import { TuiContributionRegistry } from '../contributions/index.js';
import type { RawTuiExecOptions } from '../headless/invocation.js';
import {
  applyExecCliContract,
  applyExecReviewCliContract,
  applyInteractiveCliContract,
  resolveInteractiveLaunchRequest,
  type RawTuiInteractiveOptions,
  type TuiInteractiveLaunchRequest,
} from './contract.js';
import type { AlranProviderCliRequest } from './provider-command.js';
import {
  isModelProviderApiFormat,
  ALRAN_PROVIDER_API_FORMATS,
  type AlranProviderApiFormat,
} from '../provider/contract.js';
import type {
  AlranPluginCliRequest,
  AlranPluginMarketplace,
  AlranSkillCliRequest,
} from '../plugin/contract.js';
import { resolveTuiManagedBackendLane } from './environment.js';
import {
  applySystemPromptCliOptions,
  inheritSystemPromptOptions,
  rejectUnsupportedSystemPromptOptions,
  resolveSystemPromptOverrides,
  SYSTEM_PROMPT_OPTION_NAMES,
  type RawSystemPromptOptions,
  type SystemPromptOverrides,
} from './system-prompt-options.js';
import type { AlranTelemetryCliAction } from './telemetry-command.js';
import { registerMascotCommand } from './mascot-command.js';
import { registerAccountCommands } from './account-commands.js';
import { registerCiCommand } from './ci-command.js';

export type { TuiInteractiveLaunchRequest } from './contract.js';

export interface TuiCliCommandContribution {
  readonly id: string;
  readonly order?: number;
  readonly name: string;
  readonly register: (program: Command, options: CreateTuiProgramOptions) => void;
}

export interface CreateTuiProgramOptions {
  version: string;
  launchTui: (request: TuiInteractiveLaunchRequest) => Promise<void>;
  runExec: (
    prompt: string | undefined,
    commandOptions: RawTuiExecOptions,
    lane?: string,
  ) => Promise<void>;
  runAcp?: (lane?: string, systemPromptOverrides?: SystemPromptOverrides) => Promise<void>;
  runLogin: (
    region?: AlranRegion,
    openBrowser?: boolean,
    lane?: string,
    provider?: 'api-key' | 'keycloak' | 'platform',
    platformEnv?: 'dev' | 'prod',
  ) => Promise<void>;
  runLogout: (region?: AlranRegion) => Promise<void>;
  runUpdate: () => Promise<void>;
  runProvider?: (request: AlranProviderCliRequest, lane?: string) => Promise<void>;
  runPlugin?: (request: AlranPluginCliRequest, lane?: string) => Promise<void>;
  runSkills?: (request: AlranSkillCliRequest, lane?: string) => Promise<void>;
  runTelemetry?: (action: AlranTelemetryCliAction) => Promise<void>;
  resolveLane?: typeof resolveTuiManagedBackendLane;
  allowStartupEnvironmentSelection?: boolean;
  commandContributions?: readonly TuiCliCommandContribution[];
}

export function createTuiProgram(options: CreateTuiProgramOptions): Command {
  let activeLane: string | undefined;
  const withLane = <T extends object>(request: T): T & { lane?: string } => ({
    ...request,
    ...(activeLane ? { lane: activeLane } : {}),
  });
  const runProvider = (request: AlranProviderCliRequest) =>
    activeLane
      ? requireProviderRunner(options)(request, activeLane)
      : requireProviderRunner(options)(request);
  const runPlugin = (request: AlranPluginCliRequest) =>
    activeLane
      ? requirePluginRunner(options)(request, activeLane)
      : requirePluginRunner(options)(request);
  const runSkills = (request: AlranSkillCliRequest) =>
    activeLane
      ? requireSkillsRunner(options)(request, activeLane)
      : requireSkillsRunner(options)(request);
  const program = applyInteractiveCliContract(
    new Command()
      .name('alran')
      .description('Alran Code — terminal coding agent')
      .version(options.version)
      .enablePositionalOptions(),
    { allowStartupEnvironmentSelection: options.allowStartupEnvironmentSelection },
  ).action((prompt: string | undefined, commandOptions: RawTuiInteractiveOptions) =>
    options.launchTui(withLane(resolveInteractiveLaunchRequest(prompt, commandOptions))),
  );

  program.hook('preAction', (_program, actionCommand) => {
    rejectUnsupportedSystemPromptOptions(actionCommand);
    activeLane = (options.resolveLane ?? resolveTuiManagedBackendLane)(
      program.opts<{ lane?: string }>().lane,
    );
  });

  program
    .command('init')
    .description('Analyze the codebase and generate AGENTS.md with the Runtime init Skill')
    .argument('[directory]', 'project directory', '.')
    // Session Project resolution only accepts absolute workspace paths, so the
    // default '.' and any relative directory must be resolved at the CLI boundary.
    .action((directory: string) =>
      options.launchTui(withLane({ initialPrompt: '/init', workspaceDir: resolve(directory) })),
    );

  const exec = program.command('exec').description('Run one prompt without starting the TUI');
  applyExecCliContract(exec).action(
    (prompt: string | undefined, commandOptions: RawTuiExecOptions) => {
      const resolved = inheritSystemPromptOptions(exec, commandOptions);
      return activeLane
        ? options.runExec(prompt, resolved, activeLane)
        : options.runExec(prompt, resolved);
    },
  );
  applyExecReviewCliContract(
    exec.command('review').description('Review staged, unstaged, and untracked local changes'),
  ).action((_commandOptions: RawTuiExecOptions, command: Command) => {
    const reviewOptions = inheritSystemPromptOptions(
      command,
      resolveExecReviewOptions(exec, command),
    );
    return activeLane
      ? options.runExec(undefined, reviewOptions, activeLane)
      : options.runExec(undefined, reviewOptions);
  });

  const acp = applySystemPromptCliOptions(
    program
      .command('acp')
      .description('Run Alran Code as an Agent Client Protocol server over stdio'),
  )
    .allowExcessArguments(false)
    .action((commandOptions: RawSystemPromptOptions, command: Command) => {
      const runAcp = requireAcpRunner(options);
      const systemPromptOverrides = resolveSystemPromptOverrides(
        inheritSystemPromptOptions(command, commandOptions),
      );
      if (systemPromptOverrides) return runAcp(activeLane, systemPromptOverrides);
      return activeLane ? runAcp(activeLane) : runAcp();
    });

  acp
    .command('login')
    .description('Connect to the Ottili AI Platform')
    .option('--no-browser', 'print the sign-in page URL without opening a browser')
    .allowExcessArguments(false)
    .action((commandOptions: { browser?: boolean }) =>
      activeLane
        ? options.runLogin(undefined, commandOptions.browser !== false, activeLane)
        : options.runLogin(undefined, commandOptions.browser !== false),
    );

  program
    .command('login')
    .description('Connect Alran Code to the Ottili AI Platform')
    .option('--no-browser', 'print the sign-in page URL without opening a browser')
    .option(
      '--provider <provider>',
      'login provider: api-key, keycloak or platform',
      (value: string) => {
        if (value === 'api-key' || value === 'keycloak' || value === 'platform') return value;
        throw new InvalidArgumentError('expected "api-key", "keycloak" or "platform"');
      },
      'platform',
    )
    .option(
      '--platform-env <env>',
      'Platform environment: dev (local Platform) or prod (ottili.one); defaults to the build environment',
      (value: string) => {
        if (value === 'dev' || value === 'prod') return value;
        throw new InvalidArgumentError('expected "dev" or "prod"');
      },
    )
    .argument('[provider]', 'login provider: api-key, keycloak or platform')
    .argument(
      '[platform-env]',
      'Platform environment: dev (local Platform) or prod (ottili.one); defaults to the build environment',
    )
    .allowExcessArguments(false)
    // Commander passes declared positional arguments first, then the options
    // object. Reading them in the other order silently selects the API-key path.
    .action((positionalProvider: string | undefined, positionalPlatformEnv: string | undefined, commandOptions: { browser?: boolean; provider?: string; platformEnv?: string }) => {
      const provider =
        (positionalProvider ?? commandOptions.provider ?? 'platform') as
          | 'api-key'
          | 'keycloak'
          | 'platform';
      // Left undefined when not given: the login command then signs in to the
      // Platform its build targets (local dev, real ottili.one in prod).
      const platformEnv = (positionalPlatformEnv ?? commandOptions.platformEnv) as
        | 'dev'
        | 'prod'
        | undefined;
      return activeLane
        ? options.runLogin(
            undefined,
            commandOptions.browser !== false,
            activeLane,
            provider,
            platformEnv,
          )
        : options.runLogin(
            undefined,
            commandOptions.browser !== false,
            undefined,
            provider,
            platformEnv,
          );
    });

  program
    .command('logout')
    .description('Sign out: revoke the session at the Ottili Platform and remove local credentials')
    .allowExcessArguments(false)
    .action(() => options.runLogout());

  program
    .command('update')
    .description('Check for and install an Alran Code update')
    .option('--source <url>', 'self-hosted release source (signed manifests); default: npm or the Ottili release host')
    .allowExcessArguments(false)
    .action((commandOptions: { source?: string }) => {
      // The source travels as the documented environment variable, the one place the updater reads it.
      if (commandOptions.source) process.env.ALRAN_UPDATE_SOURCE = commandOptions.source;
      return options.runUpdate();
    });

  const telemetry = program
    .command('telemetry')
    .description('Inspect anonymous TUI usage reporting');

  telemetry
    .command('status')
    .description('Show whether usage reporting is enabled and why')
    .allowExcessArguments(false)
    .action(() => requireTelemetryRunner(options)('status'));

  telemetry
    .command('preview')
    .description('Show a representative decoded request without sending it')
    .allowExcessArguments(false)
    .action(() => requireTelemetryRunner(options)('preview'));

  const provider = program
    .command('provider')
    .description('Manage model providers and API keys')
    .allowExcessArguments(false)
    .action(() => options.launchTui(withLane({ initialPrompt: '/provider' })));

  provider
    .command('list')
    .description('List configured providers')
    .option('--json', 'print a JSON document')
    .action((commandOptions: { json?: boolean }) =>
      runProvider({ action: 'list', json: commandOptions.json }),
    );

  provider
    .command('add')
    .description('Add a custom provider')
    .requiredOption('--name <name>', 'provider display name')
    .requiredOption('--base-url <url>', 'provider API base URL')
    .option(
      '--api-format <format>',
      ALRAN_PROVIDER_API_FORMATS.join(', '),
      parseApiFormat,
      'anthropic-messages',
    )
    .option('--model <id>', 'model ID (repeatable)', collectOptionValue, [])
    .option('--api-key-env <name>', 'environment variable containing the API key')
    .option('--context-limit <tokens>', 'context limit for every listed model', parsePositiveSafeInteger)
    .option('--output-limit <tokens>', 'output limit for every listed model', parsePositiveSafeInteger)
    .option('--support-image', 'declare image input support for every listed model')
    .option('--use', 'test the first model, then save and select it as the default')
    .action(
      (commandOptions: {
        name: string;
        baseUrl: string;
        apiFormat: AlranProviderApiFormat;
        model: string[];
        contextLimit?: number;
        outputLimit?: number;
        supportImage?: boolean;
        apiKeyEnv?: string;
        use?: boolean;
      }) => {
        if (commandOptions.model.length === 0) {
          throw new Error('At least one --model <id> is required.');
        }
        return runProvider({
          action: 'add',
          name: commandOptions.name,
          baseUrl: commandOptions.baseUrl,
          apiFormat: commandOptions.apiFormat,
          models: commandOptions.model,
          contextLimit: commandOptions.contextLimit,
          outputLimit: commandOptions.outputLimit,
          supportImage: commandOptions.supportImage,
          apiKeyEnv: commandOptions.apiKeyEnv,
          saveAndUse: commandOptions.use,
        });
      },
    );

  provider
    .command('remove')
    .description('Remove a custom provider')
    .argument('<provider-id>', 'custom_provider:<id>')
    .option('--yes', 'confirm removal')
    .action((providerId: string, commandOptions: { yes?: boolean }) =>
      runProvider({
        action: 'remove',
        providerId,
        confirmed: Boolean(commandOptions.yes),
      }),
    );

  provider
    .command('test')
    .description('Test a provider or one configured model')
    .argument('<provider-id>', 'provider id')
    .option('--model <id>', 'test one model')
    .option('--json', 'print a JSON document')
    .action((providerId: string, commandOptions: { model?: string; json?: boolean }) =>
      runProvider({
        action: 'test',
        providerId,
        modelId: commandOptions.model,
        json: commandOptions.json,
      }),
    );

  provider
    .command('use')
    .description('Choose the Alran credential source')
    .argument('<source>', 'token-plan or api-key', parseProviderSource)
    .action((source: 'token_plan' | 'alran_api_key') => runProvider({ action: 'use', source }));

  provider
    .command('set-alran-key')
    .description('Save and use a Alran API key')
    .option('--api-key-env <name>', 'environment variable containing the API key')
    .action((commandOptions: { apiKeyEnv?: string }) =>
      runProvider({
        action: 'set-alran-key',
        apiKeyEnv: commandOptions.apiKeyEnv,
      }),
    );

  const plugin = program
    .command('plugin')
    .alias('plugins')
    .description('Browse, install and manage Alran Code Plugins (the Plugin Store)')
    .allowExcessArguments(false)
    .action(() => options.launchTui(withLane({ initialPrompt: '/plugin' })));

  plugin
    .command('search')
    .description('Search the Plugin Store')
    .argument('[query...]', 'words to look for in names and descriptions')
    .option('--refresh', 'ask the stores again instead of using the cached index')
    .option('--json', 'print a JSON document')
    .action((query: string[], commandOptions: { refresh?: boolean; json?: boolean }) =>
      runPlugin({
        action: 'search',
        ...(query.length ? { query: query.join(' ') } : {}),
        refresh: commandOptions.refresh,
        json: commandOptions.json,
      }),
    );

  plugin
    .command('info')
    .description('Show what a Plugin contains before installing it')
    .argument('<plugin[@store]>', 'Plugin name')
    .option('--json', 'print a JSON document')
    .action((selector: string, commandOptions: { json?: boolean }) =>
      runPlugin({ action: 'info', selector, json: commandOptions.json }),
    );

  plugin
    .command('update')
    .description('Update installed Plugins from their store')
    .argument('[plugin[@store]]', 'Plugin name (default: every Plugin with an update)')
    .option('-y, --yes', 'approve Plugins that run commands without asking')
    .option('--json', 'print a JSON document')
    .action((selector: string | undefined, commandOptions: { yes?: boolean; json?: boolean }) =>
      runPlugin({
        action: 'update',
        ...(selector ? { selector } : {}),
        yes: commandOptions.yes,
        json: commandOptions.json,
      }),
    );

  plugin
    .command('list')
    .description('List installed or available Plugins')
    .option('-m, --marketplace <marketplace>', 'official or local', parsePluginMarketplace)
    .option('--available', 'include uninstalled Plugins')
    .option('--json', 'print a JSON document')
    .action(
      (commandOptions: {
        marketplace?: AlranPluginMarketplace;
        available?: boolean;
        json?: boolean;
      }) =>
        runPlugin({
          action: 'list',
          marketplace: commandOptions.marketplace,
          available: commandOptions.available,
          json: commandOptions.json,
        }),
    );

  for (const action of ['add', 'remove', 'enable', 'disable'] as const) {
    const actionCommand = plugin.command(action);
    // `alran plugins install <name>` is the same as `alran plugin add <name>`.
    if (action === 'add') actionCommand.alias('install');
    actionCommand
      .description(`${pluginActionLabel(action)} a Plugin`)
      .argument('<plugin[@store|@official|@local]>', 'Plugin selector')
      .option('-m, --marketplace <marketplace>', 'official or local', parsePluginMarketplace)
      .option('-y, --yes', 'approve a Plugin that runs commands without asking (install)')
      .option('--json', 'print a JSON document')
      .action(
        (
          selector: string,
          commandOptions: { marketplace?: AlranPluginMarketplace; yes?: boolean; json?: boolean },
        ) =>
          runPlugin({
            action,
            selector,
            marketplace: commandOptions.marketplace,
            yes: commandOptions.yes,
            json: commandOptions.json,
          }),
      );
  }

  const marketplace = plugin
    .command('marketplace')
    .description('List, add, remove or refresh the stores and folders Plugins come from');

  marketplace
    .command('add')
    .description('Add a store (an https URL, a file path or a Git-hosted index.json)')
    .argument('<url>', 'location of the store (a directory or index.json URL)')
    .option('--name <name>', 'short name to select its packages with, e.g. name@store')
    .option('--json', 'print a JSON document')
    .action((url: string, commandOptions: { name?: string; json?: boolean }) =>
      runPlugin({
        action: 'marketplace-add',
        url,
        ...(commandOptions.name ? { name: commandOptions.name } : {}),
        json: commandOptions.json,
      }),
    );

  marketplace
    .command('remove')
    .description('Remove a store you added; its installed packages stay')
    .argument('<name>', 'store name from `alran plugin marketplace list`')
    .option('--json', 'print a JSON document')
    .action((name: string, commandOptions: { json?: boolean }) =>
      runPlugin({ action: 'marketplace-remove', name, json: commandOptions.json }),
    );

  marketplace
    .command('list')
    .description('List Plugin sources')
    .option('--json', 'print a JSON document')
    .action((commandOptions: { json?: boolean }) =>
      runPlugin({ action: 'marketplace-list', json: commandOptions.json }),
    );

  marketplace
    .command('upgrade')
    .description('Refresh all Plugin source snapshots')
    .option('--json', 'print a JSON document')
    .action((commandOptions: { json?: boolean }) =>
      runPlugin({
        action: 'marketplace-upgrade',
        json: commandOptions.json,
      }),
    );

  const skills = program
    .command('skills')
    .alias('skill')
    .description('Browse, install and update Skills (the Skill Library)')
    .allowExcessArguments(false)
    .action(() => options.launchTui(withLane({ initialPrompt: '/skills library' })));

  skills
    .command('list')
    .description('List the Skills of the library, by group')
    .option('--installed', 'only Skills that are installed')
    .option('--json', 'print a JSON document')
    .action((commandOptions: { installed?: boolean; json?: boolean }) =>
      runSkills({ action: 'list', installed: commandOptions.installed, json: commandOptions.json }),
    );

  skills
    .command('search')
    .description('Search the Skill Library')
    .argument('[query...]', 'words to look for in names and descriptions')
    .option('--refresh', 'ask the stores again instead of using the cached index')
    .option('--json', 'print a JSON document')
    .action((query: string[], commandOptions: { refresh?: boolean; json?: boolean }) =>
      runSkills({
        action: 'search',
        ...(query.length ? { query: query.join(' ') } : {}),
        refresh: commandOptions.refresh,
        json: commandOptions.json,
      }),
    );

  skills
    .command('info')
    .description('Show what a Skill is for before installing it')
    .argument('<skill[@store]>', 'Skill name')
    .option('--json', 'print a JSON document')
    .action((selector: string, commandOptions: { json?: boolean }) =>
      runSkills({ action: 'info', selector, json: commandOptions.json }),
    );

  skills
    .command('add')
    .alias('install')
    .description('Install a Skill from the library')
    .argument('<skill[@store]>', 'Skill name')
    .option('--json', 'print a JSON document')
    .action((selector: string, commandOptions: { json?: boolean }) =>
      runSkills({ action: 'add', selector, json: commandOptions.json }),
    );

  skills
    .command('update')
    .description('Update installed Skills from their store')
    .argument('[skill[@store]]', 'Skill name (default: every Skill with an update)')
    .option('--json', 'print a JSON document')
    .action((selector: string | undefined, commandOptions: { json?: boolean }) =>
      runSkills({
        action: 'update',
        ...(selector ? { selector } : {}),
        json: commandOptions.json,
      }),
    );

  skills
    .command('remove')
    .alias('uninstall')
    .description('Remove a Skill the library installed')
    .argument('<skill[@store]>', 'Skill name')
    .option('--json', 'print a JSON document')
    .action((selector: string, commandOptions: { json?: boolean }) =>
      runSkills({ action: 'remove', selector, json: commandOptions.json }),
    );

  const contributionRegistry = new TuiContributionRegistry<TuiCliCommandContribution>();
  contributionRegistry.registerAll(options.commandContributions ?? []);
  for (const contribution of contributionRegistry.freeze()) {
    if (program.commands.some((command) => command.name() === contribution.name)) {
      throw new Error(`Duplicate CLI command name: ${contribution.name}`);
    }
    contribution.register(program, options);
  }

  registerMascotCommand(program);
  registerCiCommand(program);
  // The Ottili account: auth, config, models, usage, billing.
  registerAccountCommands(program, undefined, options.version);

  return program;
}

function resolveExecReviewOptions(exec: Command, review: Command): RawTuiExecOptions {
  const options: RawTuiExecOptions = { ...review.opts<RawTuiExecOptions>(), review: true };
  const supportedOptions = new Set(review.options.map((option) => option.attributeName()));
  for (const option of exec.options) {
    const name = option.attributeName();
    if (exec.getOptionValueSource(name) !== 'cli') continue;
    if (!supportedOptions.has(name)) {
      review.error(`error: option '${option.long}' is not supported by 'exec review'`, {
        code: 'commander.unknownOption',
      });
    }
    // Prompt flags are resolved per slot by inheritSystemPromptOptions.
    if (SYSTEM_PROMPT_OPTION_NAMES.has(name)) continue;
    // Child defaults must not mask explicit parent options, especially permissions.
    if (review.getOptionValueSource(name) !== 'cli') {
      Object.assign(options, { [name]: exec.getOptionValue(name) });
    }
  }
  return options;
}

function collectOptionValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseLoginRegion(value: string): AlranRegion {
  if (value === 'cn') return 'cn';
  if (value === 'global') return 'en';
  throw new InvalidArgumentError('expected "cn" or "global"');
}

function parseApiFormat(value: string): AlranProviderApiFormat {
  if (isModelProviderApiFormat(value)) return value;
  throw new InvalidArgumentError(`expected one of: ${ALRAN_PROVIDER_API_FORMATS.join(', ')}`);
}

function parseProviderSource(value: string): 'token_plan' | 'alran_api_key' {
  if (value === 'token-plan') return 'token_plan';
  if (value === 'api-key') return 'alran_api_key';
  throw new InvalidArgumentError('expected "token-plan" or "api-key"');
}

function parsePluginMarketplace(value: string): AlranPluginMarketplace {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'official' || normalized === 'local') return normalized;
  throw new InvalidArgumentError('expected "official" or "local"');
}

function pluginActionLabel(action: 'add' | 'remove' | 'enable' | 'disable'): string {
  if (action === 'add') return 'Install';
  if (action === 'remove') return 'Uninstall';
  return action === 'enable' ? 'Enable' : 'Disable';
}

function requireProviderRunner(options: CreateTuiProgramOptions) {
  if (!options.runProvider) throw new Error('Provider management is unavailable.');
  return options.runProvider;
}

function requirePluginRunner(options: CreateTuiProgramOptions) {
  if (!options.runPlugin) throw new Error('Plugin management is unavailable.');
  return options.runPlugin;
}

function requireSkillsRunner(options: CreateTuiProgramOptions) {
  if (!options.runSkills) throw new Error('Skill management is unavailable.');
  return options.runSkills;
}

function requireAcpRunner(options: CreateTuiProgramOptions) {
  if (!options.runAcp) throw new Error('ACP server is unavailable.');
  return options.runAcp;
}

function requireTelemetryRunner(options: CreateTuiProgramOptions) {
  if (!options.runTelemetry) throw new Error('Telemetry inspection is unavailable.');
  return options.runTelemetry;
}

function parsePositiveSafeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new InvalidArgumentError('expected a positive safe integer');
  }
  return number;
}
