import type { ModelConfig } from '@alran/config';

export const ALRAN_PROVIDER_API_FORMATS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'google-generative-ai',
] as const;
export type AlranProviderApiFormat = (typeof ALRAN_PROVIDER_API_FORMATS)[number];

const ALRAN_PROVIDER_API_FORMAT_SET = new Set<string>(ALRAN_PROVIDER_API_FORMATS);

export function isModelProviderApiFormat(value: unknown): value is AlranProviderApiFormat {
  return typeof value === 'string' && ALRAN_PROVIDER_API_FORMAT_SET.has(value);
}
export type AlranAlranModelSource = 'token_plan' | 'alran_api_key';
export type AlranProviderKind = 'codex-oauth' | 'alran-oauth' | 'alran-api-key' | 'custom';

export interface AlranProviderStatus {
  readonly state: string;
  readonly lastTestedAt?: number;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
}

export interface AlranProviderModel {
  readonly modelId: string;
  readonly displayName?: string;
  readonly selected?: boolean;
  readonly contextLimit?: number;
  readonly maxOutputTokens?: number;
  readonly status?: AlranProviderStatus;
}

export interface AlranRuntimeProviderView {
  readonly providerId: string;
  readonly name?: string;
  readonly kind?: string;
  readonly enabled?: boolean;
  readonly apiFormat?: string;
  readonly baseUrl?: string;
  readonly hasApiKey?: boolean;
  readonly maskedApiKey?: string;
  readonly rawApiKey?: string;
  readonly configRevision?: string;
  readonly models?: readonly AlranProviderModel[];
  readonly status?: AlranProviderStatus;
}

export interface AlranProviderView {
  readonly providerId: string;
  readonly name: string;
  readonly kind: AlranProviderKind;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly configRevision?: string;
  readonly apiFormat?: AlranProviderApiFormat;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly maskedApiKey?: string;
  readonly models: readonly AlranProviderModel[];
  readonly status?: AlranProviderStatus;
}

export interface AlranProviderSnapshot {
  readonly alranModelSource: AlranAlranModelSource;
  readonly providers: readonly AlranProviderView[];
}

export interface AlranProviderModelInput {
  readonly modelId: string;
  readonly displayName?: string;
  readonly configurationSource?: 'manual' | 'discovered';
  readonly enabled?: boolean;
  readonly attachment?: boolean;
  readonly reasoning?: boolean;
  readonly toolCall?: boolean;
  readonly temperature?: boolean;
  readonly capabilities?: Readonly<NonNullable<ModelConfig['capabilities']>>;
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] };
  readonly limit?: { readonly context?: number; readonly output?: number };
}

export interface AlranProviderTemplate {
  readonly providerId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiFormat: AlranProviderApiFormat;
  readonly models: readonly AlranProviderModelInput[];
}

export type AlranCodexOAuthState = 'hidden' | 'disconnected' | 'pending' | 'connected' | 'failed';

export type AlranCodexOAuthLoginMethod = 'browser' | 'device_code';
export interface AlranCodexOAuthLoginOptions {
  readonly method?: AlranCodexOAuthLoginMethod;
}
export interface AlranCodexOAuthStatus {
  readonly state: AlranCodexOAuthState;
  readonly providerId: 'openai-codex';
  readonly error?: string;
  readonly loginId?: string;
  readonly method?: AlranCodexOAuthLoginMethod;
  readonly authUrl?: string;
  readonly deviceCode?: {
    readonly userCode: string;
    readonly verificationUri: string;
    readonly expiresAt: number;
  };
}

export interface AlranCodexOAuthStartResult extends AlranCodexOAuthStatus {
  readonly authUrl?: string;
}

export interface AlranCreateProviderInput {
  readonly name?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiFormat: AlranProviderApiFormat;
  readonly models: readonly AlranProviderModelInput[];
  readonly saveAndUse?: boolean;
}

export interface AlranUpdateProviderInput {
  readonly providerId: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiFormat?: AlranProviderApiFormat;
  readonly enabled?: boolean;
  readonly models?: readonly AlranProviderModelInput[];
  readonly saveAndUse?: boolean;
}

export interface AlranSaveProviderCandidateInput extends Omit<
  AlranCreateProviderInput,
  'apiKey' | 'apiFormat' | 'models'
> {
  readonly providerId?: string;
  readonly expectedRevision?: string;
  readonly apiKey?: string;
  readonly apiFormat?: AlranProviderApiFormat;
  readonly models?: readonly AlranProviderModelInput[];
  readonly modelId: string;
  readonly skipConnectionTest?: boolean;
}

export type AlranDiscoverProviderModelsInput = {
  readonly baseUrl: string;
} & (
  | { readonly providerId: string; readonly expectedRevision: string }
  | { readonly name: string; readonly apiKey: string; readonly apiFormat: AlranProviderApiFormat }
);

export interface AlranSaveProviderCandidateResult {
  readonly success: boolean;
  readonly status?: AlranProviderStatus;
  readonly provider?: AlranRuntimeProviderView;
}

export interface AlranProviderTestResult {
  readonly success: boolean;
  readonly status: AlranProviderStatus;
}

export interface AlranProviderRuntimePort {
  discoverUserModelsCandidate(
    input: AlranDiscoverProviderModelsInput,
  ): Promise<readonly AlranProviderModel[]>;
  listProviderPresets(): Promise<readonly AlranProviderTemplate[]>;
  getCodexOAuthStatus(): Promise<AlranCodexOAuthStatus>;
  startCodexOAuthLogin(options?: AlranCodexOAuthLoginOptions): Promise<AlranCodexOAuthStartResult>;
  cancelCodexOAuthLogin(loginId: string): Promise<AlranCodexOAuthStatus>;
  listUserModelProviders(): Promise<readonly AlranRuntimeProviderView[]>;
  getAlranApiKeyStatus(): Promise<{
    readonly hasApiKey: boolean;
    readonly maskedApiKey?: string;
    readonly rawApiKey?: string;
    readonly cachedStatus?: AlranProviderStatus;
  }>;
  getAlranModelSource(): Promise<AlranAlranModelSource>;
  setAlranModelSource(source: AlranAlranModelSource): Promise<AlranAlranModelSource>;
  upsertAlranApiKey(input: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }): Promise<void>;
  createUserModelProvider(input: AlranCreateProviderInput): Promise<void>;
  saveUserModelProviderCandidate(
    input: AlranSaveProviderCandidateInput,
  ): Promise<AlranSaveProviderCandidateResult>;
  updateUserModelProvider(input: AlranUpdateProviderInput): Promise<void>;
  deleteUserModelProvider(providerId: string): Promise<void>;
  testUserModelProvider(providerId: string): Promise<AlranProviderTestResult>;
  testUserModel(providerId: string, modelId: string): Promise<AlranProviderTestResult>;
}
