import { getPrimaryDataDirPath, getProfile } from '@mavis/config';
import { resolveAlranDataEnvironment, type AlranDataEnvironment } from '../auth/environment.js';
import { configureTuiRuntimeEnvironment } from '../cli/environment.js';

export type TuiDefaultDataDirResolver = () => string;

export interface TuiDataDirEnvironment {
  ALRAN_DATA_DIR?: string;
  MAVIS_DATA_DIR?: string;
}

export interface PrepareTuiDataDirOptions {
  environment?: TuiDataDirEnvironment;
  getBuildEnv?: () => AlranDataEnvironment;
  getDefaultDataDir?: TuiDefaultDataDirResolver;
  configureRuntimeEnvironment?: typeof configureTuiRuntimeEnvironment;
}

export function resolveDefaultTuiDataDir(
  _buildEnv: AlranDataEnvironment,
  getPrimaryDataDir: typeof getPrimaryDataDirPath = getPrimaryDataDirPath,
  getCurrentProfile: typeof getProfile = getProfile,
): string {
  return getPrimaryDataDir(undefined, getCurrentProfile());
}

function getDefaultTuiDataDir(): string {
  return resolveDefaultTuiDataDir(resolveAlranDataEnvironment());
}

function readDataDirOverride(environment: TuiDataDirEnvironment): string | undefined {
  const alranDataDir = environment.ALRAN_DATA_DIR?.trim();
  if (alranDataDir) return alranDataDir;

  const mavisDataDir = environment.MAVIS_DATA_DIR?.trim();
  return mavisDataDir || undefined;
}

export function getTuiDataDirPath(
  environment: TuiDataDirEnvironment = process.env,
  getDefaultDataDir: () => string = getDefaultTuiDataDir,
): string {
  return readDataDirOverride(environment) ?? getDefaultDataDir();
}

export function resolveTuiDataDir(
  getDefaultDataDir: TuiDefaultDataDirResolver = getDefaultTuiDataDir,
  environment: TuiDataDirEnvironment = process.env,
): string {
  return getTuiDataDirPath(environment, getDefaultDataDir);
}

export function prepareTuiDataDir(options: PrepareTuiDataDirOptions = {}): Promise<string> {
  const buildEnv = (options.getBuildEnv ?? resolveAlranDataEnvironment)();
  const dataDir = resolveTuiDataDir(
    options.getDefaultDataDir ?? (() => resolveDefaultTuiDataDir(buildEnv)),
    options.environment ?? process.env,
  );
  (options.configureRuntimeEnvironment ?? configureTuiRuntimeEnvironment)({
    dataDir,
  });
  return Promise.resolve(dataDir);
}
