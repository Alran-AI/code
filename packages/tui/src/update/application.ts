import {
  AlranUpdateService,
  resolveAlranInstallRoot,
  type AlranUpdateApplyResult,
  type AlranUpdateCheckResult,
  type AlranUpdateRequest,
} from './service.js';
import {
  ALRAN_NPM_PACKAGE_NAME,
  buildAlranPackageManagerCommand,
  bindAlranNpmCommandToRuntime,
  createAlranNpmRuntimeEnvironment,
  detectAlranInstallSource,
  resolveAlranNpmDistribution,
  isLegacyAlranPackageName,
  resolveAlranNpmDistTag,
  resolveAlranNpmPrefixInstall,
  resolveInstalledAlranPackageVersion,
  resolveLatestAlranRegistryVersion,
  runAlranPackageManagerCommand,
  type AlranInstallSource,
  type AlranNpmDistTag,
  type AlranNpmDistribution,
  type AlranNpmPackageName,
  type AlranNpmPrefixInstall,
  type AlranPackageManagerCommand,
  type AlranPackageManagerInstallSource,
  type AlranPackageManagerRunOptions,
} from './install-source.js';
import { compareAlranVersions } from './release.js';
import { reportAlranUpdatePhase } from './progress.js';
import {
  alranPrefixNonPrefixPlanMessage,
  alranPrefixNotStagedMessage,
  alranPrefixOwnershipMissingMessage,
  alranPrefixPendingActivationMessage,
  alranPrefixPendingCleanupMessage,
  alranPrefixVersionedInstalledMessage,
  alranPrefixStagedVersionMismatchMessage,
} from './messages.js';
import {
  countAlranPrefixUpdateBlockers,
  inspectPendingAlranPrefixUpdate,
  readAlranPrefixPackageMetadata,
  removeAlranPrefixUpdateStaging,
  validateAlranPrefixPackage,
  type AlranPrefixPackageMetadata,
} from './prefix-update.js';
import {
  acquireAlranVersionedPrefixUpdateLock,
  activateAlranVersionedPrefixInstall,
  createAlranVersionedPrefixStagingPrefix,
  prepareAlranVersionedPrefixStaging,
  type AlranVersionedPrefixActivation,
} from './versioned-prefix.js';

interface ManagedUpdateService {
  check(request?: AlranUpdateRequest): Promise<AlranUpdateCheckResult>;
  apply(request?: AlranUpdateRequest): Promise<AlranUpdateApplyResult>;
}

interface AlranManagedUpdatePlan {
  readonly source: 'managed-installer';
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly channel: 'stable' | 'preview';
}

interface AlranPackageManagerVersionPlan {
  readonly source: AlranPackageManagerInstallSource;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly packageTag: AlranNpmDistTag;
}

export type AlranUpdatePlan =
  | (AlranManagedUpdatePlan & { readonly kind: 'current' })
  | (AlranManagedUpdatePlan & { readonly kind: 'ahead' })
  | (AlranManagedUpdatePlan & { readonly kind: 'available' })
  | (AlranPackageManagerVersionPlan & { readonly kind: 'current' })
  | (AlranPackageManagerVersionPlan & { readonly kind: 'ahead' })
  | {
      readonly kind: 'package-manager';
      readonly source: AlranPackageManagerInstallSource;
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly packageTag: AlranNpmDistTag;
      readonly command: AlranPackageManagerCommand;
    }
  | {
      readonly kind: 'manual';
      readonly source: 'unsupported';
      readonly currentVersion: string;
      readonly command: string;
    };

export interface AlranUpdateOutcome {
  readonly applied: boolean;
  readonly message: string;
  readonly restartRequired?: boolean;
}

export type AlranUpdateApplyOptions = AlranPackageManagerRunOptions;

export interface AlranUpdateApplicationOptions {
  readonly currentVersion: string;
  readonly installRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly packageTag?: AlranNpmDistTag;
  readonly packageName?: AlranNpmPackageName;
  readonly prefixInstall?: AlranNpmPrefixInstall;
  readonly entryFile?: string;
  readonly runtimeExecutable?: string;
}

export interface AlranUpdateApplicationDependencies {
  readonly detectInstallSource: () => Promise<AlranInstallSource>;
  readonly createManagedService: () => ManagedUpdateService;
  readonly resolveLatestPackageVersion: (tag: AlranNpmDistTag) => Promise<string>;
  readonly runPackageManager: (
    command: AlranPackageManagerCommand,
    options?: AlranPackageManagerRunOptions,
  ) => Promise<void>;
  readonly readInstalledPackageVersion: () => string | undefined;
  readonly readPrefixPackageMetadata: (
    prefix: string,
    packageName: AlranNpmPackageName,
  ) => AlranPrefixPackageMetadata;
  readonly validatePrefixPackage: (
    prefix: string,
    metadata: AlranPrefixPackageMetadata,
    expectedVersion: string,
  ) => Promise<void>;
  readonly countPrefixUpdateBlockers: (activePrefix: string) => number | undefined;
  readonly removePrefixStaging: (stagingPrefix: string) => void;
  readonly createVersionedPrefixStaging: (prefix: string, version: string) => string;
  readonly prepareVersionedPrefixStaging: (stagingPrefix: string) => void;
  readonly activateVersionedPrefix: (activation: AlranVersionedPrefixActivation) => string;
  readonly acquirePrefixUpdateLock: (activePrefix: string) => () => void;
}

export class AlranUpdateApplication {
  private readonly currentVersion: string;
  private readonly packageTag: AlranNpmDistTag;
  private readonly distribution: AlranNpmDistribution;
  private readonly platform: NodeJS.Platform;
  private readonly prefixInstall?: AlranNpmPrefixInstall;
  private readonly entryFile?: string;
  private readonly runtimeExecutable: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly dependencies: AlranUpdateApplicationDependencies;

  constructor(
    options: AlranUpdateApplicationOptions,
    dependencies: Partial<AlranUpdateApplicationDependencies> = {},
  ) {
    this.currentVersion = options.currentVersion;
    const environment = options.environment ?? process.env;
    const installRoot = options.installRoot ?? resolveAlranInstallRoot(environment);
    const platform = options.platform ?? process.platform;
    this.platform = platform;
    this.environment = environment;
    this.entryFile = options.entryFile ?? process.argv[1];
    this.prefixInstall =
      options.prefixInstall ?? resolveAlranNpmPrefixInstall(this.entryFile, platform);
    // Keep updates on the Node executable recorded in the install receipt. On
    // macOS process.execPath resolves Homebrew's stable bin/node symlink into a
    // versioned Cellar path that `brew upgrade` removes.
    this.runtimeExecutable =
      options.runtimeExecutable ?? this.prefixInstall?.nodeExecutable ?? process.execPath;
    const packageManagerEnvironment = this.prefixInstall
      ? createAlranNpmRuntimeEnvironment(environment, this.runtimeExecutable, platform)
      : environment;
    this.packageTag = options.packageTag ?? resolveAlranNpmDistTag();
    this.distribution = resolveAlranNpmDistribution(
      options.packageName,
      this.prefixInstall?.registry,
    );
    this.dependencies = {
      detectInstallSource:
        dependencies.detectInstallSource ??
        (() =>
          detectAlranInstallSource({
            installRoot,
            platform,
            prefixInstall: () => this.prefixInstall,
          })),
      createManagedService:
        dependencies.createManagedService ??
        (() =>
          new AlranUpdateService({
            currentVersion: options.currentVersion,
            installRoot,
            environment,
          })),
      resolveLatestPackageVersion:
        dependencies.resolveLatestPackageVersion ??
        ((tag) =>
          resolveLatestAlranRegistryVersion(tag, {
            platform,
            distribution: this.distribution,
            environment: packageManagerEnvironment,
            ...(this.prefixInstall
              ? {
                  npmExecutable: this.prefixInstall.executable,
                  runtimeExecutable: this.runtimeExecutable,
                }
              : {}),
          })),
      runPackageManager:
        dependencies.runPackageManager ??
        ((command, progress) =>
          runAlranPackageManagerCommand(
            this.prefixInstall
              ? bindAlranNpmCommandToRuntime(command, this.runtimeExecutable)
              : command,
            packageManagerEnvironment,
            progress,
          )),
      readInstalledPackageVersion:
        dependencies.readInstalledPackageVersion ?? resolveInstalledAlranPackageVersion,
      readPrefixPackageMetadata:
        dependencies.readPrefixPackageMetadata ??
        ((prefix, packageName) => readAlranPrefixPackageMetadata(prefix, packageName, platform)),
      validatePrefixPackage:
        dependencies.validatePrefixPackage ??
        ((prefix, metadata, expectedVersion) =>
          validateAlranPrefixPackage(prefix, metadata, this.runtimeExecutable, expectedVersion)),
      countPrefixUpdateBlockers:
        dependencies.countPrefixUpdateBlockers ?? countAlranPrefixUpdateBlockers,
      removePrefixStaging: dependencies.removePrefixStaging ?? removeAlranPrefixUpdateStaging,
      createVersionedPrefixStaging:
        dependencies.createVersionedPrefixStaging ??
        ((prefix, version) => createAlranVersionedPrefixStagingPrefix(prefix, version, platform)),
      prepareVersionedPrefixStaging:
        dependencies.prepareVersionedPrefixStaging ?? prepareAlranVersionedPrefixStaging,
      activateVersionedPrefix:
        dependencies.activateVersionedPrefix ??
        ((activation) => activateAlranVersionedPrefixInstall(activation, platform)),
      acquirePrefixUpdateLock:
        dependencies.acquirePrefixUpdateLock ?? acquireAlranVersionedPrefixUpdateLock,
    };
  }

  async inspect(): Promise<AlranUpdatePlan> {
    const source = await this.dependencies.detectInstallSource();
    if (source === 'managed-installer') {
      const result = await this.dependencies.createManagedService().check();
      return {
        kind: result.status,
        source,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        channel: result.channel,
      };
    }
    if (source === 'unsupported') {
      return {
        kind: 'manual',
        source,
        currentVersion: this.currentVersion,
        command: buildAlranPackageManagerCommand(
          'npm-global',
          this.packageTag,
          this.platform,
          this.distribution,
        ).display,
      };
    }
    // An installation of the package under its old name cannot be updated in place: the new versions
    // are published as `alran`. Say what to run instead of installing a second copy next to it.
    if (isLegacyAlranPackageName(this.distribution.packageName)) {
      return {
        kind: 'manual',
        source: 'unsupported',
        currentVersion: this.currentVersion,
        command: `npm uninstall --global ${this.distribution.packageName} && npm install --global ${ALRAN_NPM_PACKAGE_NAME}`,
      };
    }
    const pendingUpdate =
      source === 'npm-prefix' ? inspectPendingAlranPrefixUpdate(this.entryFile) : undefined;
    if (pendingUpdate) {
      const latestVersion = pendingUpdate.activation.expectedVersion;
      return {
        kind: 'package-manager',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
        command: buildAlranPackageManagerCommand(
          source,
          latestVersion,
          this.platform,
          this.distribution,
          this.prefixInstall,
        ),
      };
    }
    const latestVersion = await this.dependencies.resolveLatestPackageVersion(this.packageTag);
    const comparison = compareAlranVersions(this.currentVersion, latestVersion);
    const followsRollingTag = this.packageTag !== 'latest';
    if (comparison === 0) {
      return {
        kind: 'current',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
      };
    }
    if (comparison > 0 && !followsRollingTag) {
      return {
        kind: 'ahead',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
      };
    }
    return {
      kind: 'package-manager',
      source,
      currentVersion: this.currentVersion,
      latestVersion,
      packageTag: this.packageTag,
      command: buildAlranPackageManagerCommand(
        source,
        latestVersion,
        this.platform,
        this.distribution,
        this.prefixInstall,
      ),
    };
  }

  async apply(
    plan: AlranUpdatePlan,
    options: AlranUpdateApplyOptions = {},
  ): Promise<AlranUpdateOutcome> {
    if (plan.kind === 'manual' || plan.kind === 'current' || plan.kind === 'ahead') {
      throw new Error(`Alran update plan ${plan.kind} cannot be applied automatically.`);
    }
    if (plan.kind === 'available') {
      const result = await this.dependencies.createManagedService().apply({
        channel: plan.channel,
        version: plan.latestVersion,
        ...options,
      });
      return result.applied
        ? {
            applied: true,
            message:
              `Alran ${result.latestVersion} is installed. ` +
              'Restart running Alran sessions to use it.',
          }
        : {
            applied: false,
            message: `Alran ${result.currentVersion} is already active.`,
          };
    }

    if (plan.source === 'npm-prefix') {
      return this.applyNpmPrefixUpdate(plan, options);
    }

    reportAlranUpdatePhase(options, 'installing', false);
    await this.dependencies.runPackageManager(plan.command, options);
    const installedVersion = this.dependencies.readInstalledPackageVersion();
    if (installedVersion !== plan.latestVersion) {
      throw new Error(
        `Alran update installed ${installedVersion || '<unknown>'}; expected ${plan.latestVersion}.`,
      );
    }
    reportAlranUpdatePhase(options, 'completed', false);
    return {
      applied: true,
      message:
        `Alran ${plan.latestVersion} was installed through ${packageManagerName(plan.source)}. ` +
        'Restart Alran to use the installed version.',
    };
  }

  private async applyNpmPrefixUpdate(
    plan: Extract<AlranUpdatePlan, { kind: 'package-manager' }>,
    options: AlranUpdateApplyOptions,
  ): Promise<AlranUpdateOutcome> {
    if (plan.source !== 'npm-prefix') {
      throw new Error(alranPrefixNonPrefixPlanMessage(this.environment));
    }
    const prefixInstall = this.prefixInstall;
    if (!prefixInstall) {
      throw new Error(alranPrefixOwnershipMissingMessage(this.environment));
    }
    const pendingUpdate = inspectPendingAlranPrefixUpdate(this.entryFile);
    if (pendingUpdate) {
      const blockingSessionCount = this.dependencies.countPrefixUpdateBlockers(
        pendingUpdate.activation.activePrefix,
      );
      return {
        applied: false,
        restartRequired: true,
        message:
          pendingUpdate.state === 'activated'
            ? alranPrefixPendingCleanupMessage(pendingUpdate.activation.expectedVersion, {
                blockingSessionCount,
                environment: this.environment,
              })
            : alranPrefixPendingActivationMessage(pendingUpdate.activation.expectedVersion, {
                blockingSessionCount,
                environment: this.environment,
              }),
      };
    }
    const releaseLock = this.dependencies.acquirePrefixUpdateLock(prefixInstall.prefix);
    let stagingPrefix: string | undefined;
    try {
      stagingPrefix = this.dependencies.createVersionedPrefixStaging(
        prefixInstall.prefix,
        plan.latestVersion,
      );
      const stagedCommand = buildAlranPackageManagerCommand(
        'npm-prefix',
        plan.latestVersion,
        this.platform,
        this.distribution,
        { ...prefixInstall, prefix: stagingPrefix },
      );
      reportAlranUpdatePhase(options, 'staging', true);
      this.dependencies.prepareVersionedPrefixStaging(stagingPrefix);
      reportAlranUpdatePhase(options, 'installing', false);
      await this.dependencies.runPackageManager(stagedCommand, options);
      reportAlranUpdatePhase(options, 'validating', false);
      const stagedPackage = this.dependencies.readPrefixPackageMetadata(
        stagingPrefix,
        prefixInstall.packageName,
      );
      if (stagedPackage.version !== plan.latestVersion) {
        throw new Error(
          alranPrefixStagedVersionMismatchMessage(
            stagedPackage.version,
            plan.latestVersion,
            this.environment,
          ),
        );
      }
      await this.dependencies.validatePrefixPackage(
        stagingPrefix,
        stagedPackage,
        plan.latestVersion,
      );
      reportAlranUpdatePhase(options, 'activating', false);
      this.dependencies.activateVersionedPrefix({
        stagingPrefix,
        activePrefix: prefixInstall.prefix,
        packageName: prefixInstall.packageName,
        expectedVersion: plan.latestVersion,
        runtimeExecutable: this.runtimeExecutable,
        npmExecutable: prefixInstall.executable,
        registry: prefixInstall.registry,
      });
      reportAlranUpdatePhase(options, 'completed', false);
      return {
        applied: true,
        restartRequired: false,
        message: alranPrefixVersionedInstalledMessage(plan.latestVersion, this.environment),
      };
    } catch (error) {
      if (stagingPrefix) this.dependencies.removePrefixStaging(stagingPrefix);
      throw new Error(
        alranPrefixNotStagedMessage(plan.latestVersion, errorMessage(error), this.environment),
        { cause: error },
      );
    } finally {
      releaseLock();
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function packageManagerName(source: AlranPackageManagerInstallSource): string {
  if (source === 'npm-prefix') return 'npm';
  return source.replace('-global', '');
}
