#!/usr/bin/env node

import {
  configureTuiRuntimeEnvironment,
  resolveTuiStartupEnvironmentOption,
} from './cli/environment.js';
import { prepareAlranPrefixProcess } from './update/prefix-update.js';
import { applyLegacyEnvironmentAliases, formatLegacyEnvironmentWarning } from '@alran/config';

async function main(): Promise<void> {
  // Old variable names are read under their new ones before anything else reads the environment.
  // legacy-brand-compat: TODO: remove after 2027-Q1 (docs/MIGRATION_FROM_MINIMAX.md).
  const legacyWarning = formatLegacyEnvironmentWarning(applyLegacyEnvironmentAliases(process.env));
  if (legacyWarning) process.stderr.write(`${legacyWarning}\n`);
  // Startup environment selection is an internal switch; the public package has none.
  const internalPackage = false;
  let startupBuildEnvironment: ReturnType<typeof resolveTuiStartupEnvironmentOption>;
  try {
    startupBuildEnvironment = resolveTuiStartupEnvironmentOption(
      process.argv.slice(2),
      internalPackage,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const { getTuiDataDirPath } = await import('./runtime/data-dir.js');
  configureTuiRuntimeEnvironment({
    dataDir: getTuiDataDirPath(),
    ...(startupBuildEnvironment ? { startupBuildEnvironment } : {}),
  });
  const prefixProcess = await prepareAlranPrefixProcess();
  try {
    const { runTuiCli } = await import('./cli/main.js');
    await runTuiCli({ allowStartupEnvironmentSelection: internalPackage });
  } finally {
    prefixProcess.remove();
  }
}

await main();
