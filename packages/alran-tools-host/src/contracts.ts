import type { AuthLeaseStatus } from '@mavis/oauth-lease-protocol';

export interface AlranToolsAccessTokenLease {
  accessToken: string;
  expiresAtMs: number;
  generation: number;
  scopes: readonly ['agent.default'];
  audience: 'agent-backend';
}

export interface AlranToolsAuthStatusSnapshot {
  status: AuthLeaseStatus;
  generation: number;
  expiresAtMs?: number;
}

export interface AlranToolsHostAuthSession {
  getStatus(): Promise<AlranToolsAuthStatusSnapshot>;
  getAccessToken(minValidityMs: number): Promise<AlranToolsAccessTokenLease>;
  handleUnauthorized(generation: number): Promise<'retry' | 'logout'>;
  watch(listener: (status: AlranToolsAuthStatusSnapshot) => void): () => void;
}

export interface AlranToolsHostLogger {
  info(message: string): void;
  warn(message: string): void;
}
