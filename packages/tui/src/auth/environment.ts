import { getRuntimeBuildEnv, type AlranBuildEnv, type AlranRegion } from '@alran/config';
import {
  resolveProductBuildIdentity,
  type ProductBuildIdentity,
} from '@alran/shared/product-build-identity';

export type TuiBuildEnvironment = 'test' | 'staging' | 'prod';
export type TuiBuildVariant = 'standard' | 'internal';
export type AlranDataEnvironment = TuiBuildEnvironment | 'dev';

declare const __TUI_BUILD_ENV__: TuiBuildEnvironment | undefined;
declare const __TUI_BUILD_VARIANT__: TuiBuildVariant | undefined;

export interface ResolveAlranAuthEnvironmentOptions {
  readonly embeddedBuildEnvironment?: TuiBuildEnvironment;
  readonly embeddedBuildVariant?: TuiBuildVariant;
  readonly runtimeRegion?: AlranRegion;
  readonly runtimeBuildEnv?: AlranBuildEnv;
}

export interface AlranAuthEnvironment {
  readonly region: AlranRegion;
  readonly buildEnv: AlranBuildEnv;
}

let startupBuildEnvironment: TuiBuildEnvironment | undefined;

export function setAlranStartupBuildEnvironment(
  environment: TuiBuildEnvironment | undefined,
): void {
  startupBuildEnvironment = environment;
}

export function resolveAlranBuildIdentity(
  options: ResolveAlranAuthEnvironmentOptions = {},
): ProductBuildIdentity {
  const embeddedBuildEnvironment =
    options.embeddedBuildEnvironment ?? readEmbeddedBuildEnvironment();
  const embeddedBuildVariant = options.embeddedBuildVariant ?? readEmbeddedBuildVariant();
  const runtimeBuildEnv = options.runtimeBuildEnv ?? getRuntimeBuildEnv();
  // An explicitly configured runtime environment wins over the environment the
  // bundle was built for. A locally built CLI embeds `test`, but a developer who
  // runs it with `ALRAN_BUILD_ENV=prod` must talk to the production services.
  const explicitBuildEnv = options.runtimeBuildEnv ?? readExplicitRuntimeBuildEnv();

  return resolveProductBuildIdentity({
    buildEnv: explicitBuildEnv
      ? normalizeRuntimeBuildEnvironment(explicitBuildEnv)
      : (embeddedBuildEnvironment ?? normalizeRuntimeBuildEnvironment(runtimeBuildEnv)),
    internalBuild: embeddedBuildVariant === 'internal',
  });
}

export function resolveAlranAuthEnvironment(
  options: ResolveAlranAuthEnvironmentOptions = {},
): AlranAuthEnvironment {
  const buildIdentity = resolveAlranBuildIdentity(options);

  return {
    region: options.runtimeRegion ?? 'en',
    buildEnv: startupBuildEnvironment ?? buildIdentity.buildEnv ?? 'test',
  };
}

export function resolveAlranDataEnvironment(
  embeddedBuildEnvironment: TuiBuildEnvironment | undefined = readEmbeddedBuildEnvironment(),
): AlranDataEnvironment {
  return startupBuildEnvironment ?? embeddedBuildEnvironment ?? 'dev';
}

function readEmbeddedBuildEnvironment(): TuiBuildEnvironment | undefined {
  if (typeof __TUI_BUILD_ENV__ === 'undefined') return undefined;
  return __TUI_BUILD_ENV__;
}

function readEmbeddedBuildVariant(): TuiBuildVariant | undefined {
  if (typeof __TUI_BUILD_VARIANT__ === 'undefined') return undefined;
  return __TUI_BUILD_VARIANT__;
}

function normalizeRuntimeBuildEnvironment(environment: AlranBuildEnv): AlranBuildEnv {
  return environment === 'dev' ? 'test' : environment;
}

/** `ALRAN_BUILD_ENV` when it names a known environment; `undefined` otherwise. */
function readExplicitRuntimeBuildEnv(): AlranBuildEnv | undefined {
  const value = process.env.ALRAN_BUILD_ENV;
  return value === 'test' || value === 'prod' || value === 'dev' || value === 'staging'
    ? value
    : undefined;
}
