export type ProviderAuthMode = 'managed-login' | 'api-key' | 'oauth';

export type ProviderAuthModeSource = 'explicit' | 'inferred-managed-base-url' | 'default-api-key';

export interface ResolveProviderAuthModeInput {
  authMode?: unknown;
  baseURL?: unknown;
  /** Suppress only the trusted-host warning; the URL is still reported as unmanaged. */
  allowManagedBaseURLOverride?: boolean;
}

export interface ResolvedProviderAuthMode {
  authMode: ProviderAuthMode;
  source: ProviderAuthModeSource;
  managedBaseURL: boolean;
  warnings: string[];
}

/**
 * Hosts that serve the Ottili AI Platform gateway.
 *
 * The first-party provider is authenticated with an Ottili API key, so this
 * list only records which origins the CLI trusts enough to strip URL
 * credentials from and to keep as the managed default.
 */
const MANAGED_PROVIDER_HOSTS = ['api.ottili.one'] as const;

const MANAGED_PROVIDER_ORIGINS = new Set(MANAGED_PROVIDER_HOSTS.map((host) => `https://${host}`));

/** Recognizes generated Alran aliases, including dangling refs, while preserving custom endpoints. */
export function isLegacyManagedAlranProvider(providerId: string, baseURL?: string): boolean {
  return (
    /^custom_provider:alran-legacy(?:-\d+)?$/u.test(providerId) &&
    (!baseURL || isManagedProviderBaseUrl(baseURL))
  );
}

export function isManagedProviderBaseUrl(baseURL: string): boolean {
  try {
    const parsed = new URL(baseURL);
    // URL credentials change the authority string the user intended to trust.
    // Treat them as untrusted even when the host portion matches an allowlisted
    // managed Alran origin, matching the preview opencode plugin contract.
    if (parsed.username || parsed.password) return false;
    return MANAGED_PROVIDER_ORIGINS.has(parsed.origin.toLowerCase());
  } catch {
    return false;
  }
}

function parseExplicitAuthMode(value: unknown): ProviderAuthMode | undefined {
  if (value !== 'managed-login' && value !== 'api-key' && value !== 'oauth') return undefined;
  return value;
}

export function resolveProviderAuthMode(
  input: ResolveProviderAuthModeInput | undefined,
): ResolvedProviderAuthMode {
  const baseURL = typeof input?.baseURL === 'string' ? input.baseURL.trim() : '';
  const managedBaseURL = baseURL.length > 0 && isManagedProviderBaseUrl(baseURL);
  const explicitAuthMode = parseExplicitAuthMode(input?.authMode);
  const warnings: string[] = [];

  if (typeof input?.authMode === 'string' && !explicitAuthMode) {
    warnings.push(
      `Unknown provider authMode "${input.authMode}"; falling back to compatibility resolution.`,
    );
  }

  if (explicitAuthMode) {
    if (
      explicitAuthMode === 'managed-login' &&
      baseURL.length > 0 &&
      !managedBaseURL &&
      !input?.allowManagedBaseURLOverride
    ) {
      warnings.push(
        'Provider authMode is managed-login but baseURL is not a known managed Alran host.',
      );
    }
    return {
      authMode: explicitAuthMode,
      source: 'explicit',
      managedBaseURL,
      warnings,
    };
  }

  if (managedBaseURL) {
    warnings.push(
      'Provider authMode is inferred from a managed Alran baseURL; set options.authMode: managed-login to make this explicit.',
    );
    return {
      authMode: 'managed-login',
      source: 'inferred-managed-base-url',
      managedBaseURL,
      warnings,
    };
  }

  return {
    authMode: 'api-key',
    source: 'default-api-key',
    managedBaseURL,
    warnings,
  };
}
