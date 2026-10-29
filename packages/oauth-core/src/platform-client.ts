// @ottili/oauth-core — Platform API client.
//
// A thin, session-authenticated HTTP client for the Ottili AI Platform
// (alran-platform). After an OIDC login, the Platform session id and company
// id are stored locally; this client sends them as `x-ottili-session` and
// `x-ottili-company` on every request, exactly as `@ottili/platform-sdk` does.
// It is intentionally dependency-free (plain `fetch`) so Alran Code does not
// have to vendor the Platform SDK tarball.

/** Credentials for a Platform session. */
export interface PlatformCredentials {
  readonly sessionId: string;
  readonly companyId: string;
  readonly baseUrl: string;
}

/** The result of a Platform API call. */
export interface PlatformApiResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data?: T;
  readonly problem?: { readonly code: string; readonly detail?: string };
}

/** Options for a Platform API call. */
export interface PlatformApiCallOptions<TBody = unknown> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: TBody;
  readonly idempotencyKey?: string;
}

/**
 * A session-authenticated Platform API client.
 *
 * All calls carry `x-ottili-session` and `x-ottili-company`. A session and an
 * API key are never sent together (the Platform refuses that).
 */
export class PlatformApiClient {
  private readonly credentials: PlatformCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(credentials: PlatformCredentials, fetchImpl: typeof fetch = fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
  }

  /** A new client for a different company of the same session. */
  withCompany(companyId: string): PlatformApiClient {
    return new PlatformApiClient(
      { ...this.credentials, companyId },
      this.fetchImpl,
    );
  }

  /** The base URL this client talks to. */
  get baseUrl(): string {
    return this.credentials.baseUrl;
  }

  /** Call a Platform operation and return a typed result. */
  async call<T = unknown>(options: PlatformApiCallOptions): Promise<PlatformApiResult<T>> {
    const url = new URL(options.path, this.credentials.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      'x-ottili-session': this.credentials.sessionId,
      'x-ottili-company': this.credentials.companyId,
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: options.method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        problem: {
          code: 'platform_unreachable',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }

    let data: T | undefined;
    let problem: { code: string; detail?: string } | undefined;
    try {
      const body = await res.json().catch(() => ({}));
      const record = typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
      if (res.ok && !record.error) {
        data = body as T;
      } else {
        problem = {
          code: typeof record.error === 'string'
            ? record.error
            : typeof record.code === 'string'
              ? record.code
              : 'platform_error',
          detail: typeof record.message === 'string' ? record.message : undefined,
        };
      }
    } catch {
      // Non-JSON response; treat by status.
      if (!res.ok) {
        problem = { code: `http_${res.status}`, detail: res.statusText };
      }
    }

    return { ok: res.ok, status: res.status, data, problem };
  }

  /** GET a Platform operation. */
  async get<T = unknown>(
    path: string,
    options?: Omit<PlatformApiCallOptions, 'method' | 'body'>,
  ): Promise<PlatformApiResult<T>> {
    return this.call<T>({ ...options, method: 'GET', path });
  }

  /** POST a Platform operation. */
  async post<T = unknown, TBody = unknown>(
    path: string,
    options?: Omit<PlatformApiCallOptions, 'method'> & { body?: TBody },
  ): Promise<PlatformApiResult<T>> {
    return this.call<T>({ ...(options ?? {}), method: 'POST', path, body: options?.body });
  }

  /** DELETE a Platform operation. */
  async delete<T = unknown>(
    path: string,
    options?: Omit<PlatformApiCallOptions, 'method' | 'body'>,
  ): Promise<PlatformApiResult<T>> {
    return this.call<T>({ ...options, method: 'DELETE', path });
  }
}

/** Generate a Platform idempotency key (matches @ottili/sdk-runtime's format). */
export function platformIdempotencyKey(): string {
  return `k-${crypto.randomUUID()}`;
}
