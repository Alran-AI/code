import { translateRuntimeText } from '@alran/shared/runtime-i18n';

export function alranPrefixActivationScheduledMessage(
  _environment: NodeJS.ProcessEnv = process.env,
): string {
  return 'A staged Alran update will activate after this process exits.';
}

export function alranPrefixJournalScheduleFailedMessage(
  _environment: NodeJS.ProcessEnv = process.env,
): string {
  return 'Alran update was staged, but its activation journal could not be scheduled.';
}

export function alranPrefixNonPrefixPlanMessage(_environment: NodeJS.ProcessEnv): string {
  return 'Alran npm prefix updater received a non-prefix plan.';
}

export function alranPrefixOwnershipMissingMessage(_environment: NodeJS.ProcessEnv): string {
  return 'Alran npm prefix ownership metadata is missing.';
}

export function alranPrefixPendingActivationMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Alran ${version} is already staged. Restarting will resume activation after running Alran sessions exit.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Alran ${version} is already staged. Activation will wait for ${String(blockingSessionCount)} other Alran ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit.`;
  }
  return `Alran ${version} is already staged. It will activate after this process exits.`;
}

export function alranPrefixPendingCleanupMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Alran ${version} is already active. Restarting will finish update cleanup after running Alran sessions exit.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Alran ${version} is already active. Update cleanup will wait for ${String(blockingSessionCount)} other Alran ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit.`;
  }
  return `Alran ${version} is already active. Restarting will finish update cleanup.`;
}

export function alranPrefixStagedVersionMismatchMessage(
  actualVersion: string,
  expectedVersion: string,
  _environment: NodeJS.ProcessEnv,
): string {
  return `Alran update staged ${actualVersion}; expected ${expectedVersion}.`;
}

export function alranPrefixStagedMessage(
  version: string,
  options: {
    readonly blockingSessionCount?: number;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  if (options.blockingSessionCount === undefined) {
    return `Alran ${version} is downloaded and staged safely. Waiting for running Alran sessions to exit before activation.`;
  }
  const blockingSessionCount = Math.max(0, Math.trunc(options.blockingSessionCount));
  if (blockingSessionCount > 0) {
    return `Alran ${version} is downloaded and staged safely. Waiting for ${String(blockingSessionCount)} other Alran ${blockingSessionCount === 1 ? 'session' : 'sessions'} to exit before activation.`;
  }
  return `Alran ${version} is downloaded and staged safely. It will activate after this process exits.`;
}

export function alranPrefixVersionedInstalledMessage(
  version: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const locale = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG;
  return translateRuntimeText(locale, 'update.versionedInstalled').replace('{version}', version);
}

export function alranPrefixNotStagedMessage(
  version: string,
  reason: string,
  _environment: NodeJS.ProcessEnv,
): string {
  return `Alran ${version} was not staged; the active installation is unchanged: ${reason}`;
}
