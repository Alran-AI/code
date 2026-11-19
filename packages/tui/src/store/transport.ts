import { open, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { STORE_LIMITS, StoreError } from './contract.js';
import { formatBytes } from './status.js';

export type TextRead =
  | { readonly status: 'ok'; readonly text: string; readonly etag?: string }
  | { readonly status: 'not-modified' };

/** How the Store reads an index or an archive. Tests replace it; production uses `fetch`. */
export interface StoreTransport {
  readText(
    url: string,
    options: { readonly maxBytes: number; readonly etag?: string; readonly signal?: AbortSignal },
  ): Promise<TextRead>;
  readBytes(
    url: string,
    options: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ): Promise<Buffer>;
}

export interface CreateStoreTransportOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * `https:` anywhere, `http:` only for loopback (a store under development), `file:` for a store on
 * disk or a mounted share. Redirects are followed by `fetch`; the final URL is checked again, so a
 * redirect cannot downgrade a transfer to plain HTTP.
 */
export function createStoreTransport(options: CreateStoreTransportOptions = {}): StoreTransport {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? STORE_LIMITS.fetchTimeoutMs;
  return {
    async readText(url, read) {
      if (isFileUrl(url)) {
        return { status: 'ok', text: (await readLocalFile(url, read.maxBytes)).toString('utf8') };
      }
      const response = await request(doFetch, url, timeoutMs, read.signal, {
        ...(read.etag ? { 'if-none-match': read.etag } : {}),
        accept: 'application/json',
      });
      if (response.status === 304) return { status: 'not-modified' };
      const body = await readBody(response, read.maxBytes, url);
      const etag = response.headers.get('etag') ?? undefined;
      return { status: 'ok', text: body.toString('utf8'), ...(etag ? { etag } : {}) };
    },
    async readBytes(url, read) {
      if (isFileUrl(url)) return readLocalFile(url, read.maxBytes);
      const response = await request(doFetch, url, timeoutMs, read.signal, {
        accept: 'application/octet-stream',
      });
      return readBody(response, read.maxBytes, url);
    },
  };
}

/** Throws unless a Store may talk to `url`. */
export function assertAllowedStoreUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StoreError('SOURCE_INVALID', `"${value}" is not a URL.`);
  }
  if (url.protocol === 'https:' || url.protocol === 'file:') return url;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
  throw new StoreError(
    'SOURCE_INVALID',
    `"${value}" must use https (plain http is only allowed for localhost).`,
  );
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

function isFileUrl(url: string): boolean {
  return url.startsWith('file:');
}

async function readLocalFile(url: string, maxBytes: number): Promise<Buffer> {
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch (error) {
    throw new StoreError('SOURCE_UNREACHABLE', `"${url}" is not a usable file URL.`, {
      cause: error,
    });
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new StoreError('SOURCE_UNREACHABLE', `${path} is not a file.`);
    if (info.size > maxBytes) throw tooLarge(url, maxBytes);
    const handle = await open(path, 'r');
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('SOURCE_UNREACHABLE', `Could not read ${path}: ${describe(error)}`, {
      cause: error,
    });
  }
}

async function request(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  assertAllowedStoreUrl(url);
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await doFetch(url, {
      headers,
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StoreError(
      'SOURCE_UNREACHABLE',
      `${url} could not be reached (${timeout.aborted ? 'timed out' : describe(error)}).`,
      { cause: error },
    );
  }
  if (response.url && response.url !== url) {
    try {
      assertAllowedStoreUrl(response.url);
    } catch {
      throw new StoreError('SOURCE_UNREACHABLE', `${url} redirected to a URL that is not allowed.`);
    }
  }
  if (response.status !== 304 && !response.ok) {
    throw new StoreError(
      'SOURCE_UNREACHABLE',
      `${url} answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    );
  }
  return response;
}

async function readBody(response: Response, maxBytes: number, url: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(url, maxBytes);
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        await reader.cancel();
        throw tooLarge(url, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('SOURCE_UNREACHABLE', `${url} broke off (${describe(error)}).`, {
      cause: error,
    });
  }
  return Buffer.concat(chunks, received);
}

function tooLarge(url: string, maxBytes: number): StoreError {
  return new StoreError(
    'SOURCE_REJECTED',
    `${url} is larger than the limit of ${maxBytes} bytes (${formatBytes(maxBytes)}).`,
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
