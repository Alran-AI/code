import type {
  LocalWebFetchAdapter,
  LocalWebFetchRetrievalOutcome,
  LocalWebFetchToolInput,
} from '@alran/agent-tools/desktop';

const WEB_FETCH_USER_AGENT = 'AlranAgent';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_CONTENT_TYPE_PATTERNS = [
  /^text\//iu,
  /^application\/(?:json|xml|javascript|x-javascript|x-www-form-urlencoded)\b/iu,
  /\+json\b/iu,
  /\+xml\b/iu,
];

export interface LocalWebFetchClientOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export class LocalWebFetchClient implements LocalWebFetchAdapter {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalWebFetchClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetch(
    input: LocalWebFetchToolInput,
    signal?: AbortSignal,
  ): Promise<{
    content?: string;
    status?: number;
    statusText?: string;
    finalUrl?: string;
    contentType?: string;
    retryAfter?: string;
    bytes?: number;
    truncated?: boolean;
    retrievalOutcome?: LocalWebFetchRetrievalOutcome;
    base_resp?: { status_code?: number; status_msg?: string };
  }> {
    const url = normalizeHttpUrl(input.url);
    if (!url) {
      return failure(
        `web_fetch only supports absolute http:// or https:// URLs.`,
        undefined,
        undefined,
        'invalid_request',
      );
    }
    const method = input.method ?? 'GET';
    const scoped = createScopedAbortSignal(signal, this.timeoutMs);
    try {
      // Redirects are followed here, one hop at a time, so every destination is checked and not only the
      // address the model asked for: a public page may answer 302 to the cloud metadata service.
      let current = url;
      let res: Response | undefined;
      for (let hops = 0; ; hops += 1) {
        if (isCloudMetadataHost(current)) {
          return failure(
            'web_fetch does not fetch cloud instance-metadata addresses.',
            undefined,
            undefined,
            'invalid_request',
          );
        }
        res = await this.fetchImpl(current.href, {
          method,
          headers: { 'User-Agent': WEB_FETCH_USER_AGENT },
          redirect: 'manual',
          signal: scoped.signal,
        });
        const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get('location') : null;
        if (!location) break;
        if (hops >= MAX_REDIRECTS) {
          return failure('web_fetch followed too many redirects.', undefined, undefined, 'network_error');
        }
        const next = normalizeHttpUrl(new URL(location, current).href);
        if (!next) {
          return failure('web_fetch only follows redirects to http:// or https:// URLs.', undefined, undefined, 'invalid_request');
        }
        await res.body?.cancel().catch(() => undefined);
        current = next;
      }
      const contentType = res.headers.get('content-type') ?? undefined;
      const retryAfter = res.headers.get('retry-after') ?? undefined;
      if (method === 'HEAD') {
        const outcome = classifyRetrievalOutcome(res.status, contentType, '', method);
        return {
          content: `HTTP ${res.status} ${res.statusText}`,
          status: res.status,
          statusText: res.statusText,
          finalUrl: current.href,
          ...(contentType ? { contentType } : {}),
          ...(retryAfter ? { retryAfter } : {}),
          bytes: 0,
          truncated: false,
          retrievalOutcome: outcome,
          base_resp: { status_code: 0 },
        };
      }
      if (!isTextLikeContentType(contentType)) {
        return failure(
          `web_fetch received non-text content${contentType ? ` (${contentType})` : ''}.`,
          res,
          contentType,
          'non_text',
          retryAfter,
        );
      }
      const body = await readLimitedResponseText(res, this.maxBytes);
      const outcome = classifyRetrievalOutcome(res.status, contentType, body.text, method);
      if (!res.ok) {
        return {
          content: body.text,
          status: res.status,
          statusText: res.statusText,
          finalUrl: current.href,
          ...(contentType ? { contentType } : {}),
          ...(retryAfter ? { retryAfter } : {}),
          bytes: body.bytes,
          truncated: body.truncated,
          retrievalOutcome: outcome,
          base_resp: { status_code: 0 },
        };
      }
      return {
        content: body.text,
        status: res.status,
        statusText: res.statusText,
        finalUrl: current.href,
        ...(contentType ? { contentType } : {}),
        ...(retryAfter ? { retryAfter } : {}),
        bytes: body.bytes,
        truncated: body.truncated,
        retrievalOutcome: outcome,
        base_resp: { status_code: 0 },
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const timedOut = scoped.signal.aborted;
      return failure(
        timedOut ? 'web_fetch request timed out.' : 'web_fetch network request failed.',
        undefined,
        undefined,
        'network_error',
      );
    } finally {
      scoped.dispose();
    }
  }
}

function classifyRetrievalOutcome(
  status: number,
  contentType: string | undefined,
  content: string,
  method: 'GET' | 'HEAD',
): LocalWebFetchRetrievalOutcome {
  if (status === 404 || status === 410) return 'not_found';
  if (method !== 'GET' || status === 429) {
    return status >= 200 && status < 300 ? 'usable_content' : 'http_error';
  }

  const isHtml = isHtmlContentType(contentType);
  if (isHtml && looksLikeAccessChallenge(status, content)) return 'access_challenge';
  if (isHtml && looksLikeLoginPage(status, content)) return 'auth_required';
  if (status < 200 || status >= 300) return 'http_error';
  if (isHtml && looksLikeDynamicHtmlShell(content)) {
    return 'dynamic_page';
  }
  return 'usable_content';
}

function isHtmlContentType(contentType: string | undefined): boolean {
  return /^(?:text\/html|application\/xhtml\+xml)\b/iu.test(contentType ?? '');
}

function looksLikeLoginPage(status: number, content: string): boolean {
  const forms = content.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/giu);
  for (const formMatch of forms) {
    const attributes = formMatch[1] ?? '';
    const body = formMatch[2] ?? '';
    const form = `${attributes} ${body}`;
    const hasPasswordInput =
      /<input\b[^>]*(?:\btype\s*=\s*["']?password\b|\bautocomplete\s*=\s*["']?current-password\b)/iu.test(
        body,
      );

    const hasIdentityInput =
      /<input\b[^>]*(?:\btype\s*=\s*["']?email\b|\bautocomplete\s*=\s*["']?(?:email|username)\b|\bname\s*=\s*["']?(?:email|username|user_name|login)\b)/iu.test(
        body,
      );
    const hasLoginPurpose =
      /(?:\baction|\bid|\bclass|\bname)\s*=\s*["'][^"']*(?:log[ -]?in|sign[ -]?in|auth|oauth|session)[^"']*["']/iu.test(
        attributes,
      ) || /\b(?:log[ -]?in|sign[ -]?in|continue with)\b/iu.test(visibleText(form));
    const isLoginForm =
      (hasPasswordInput && (hasLoginPurpose || status === 401)) ||
      (hasIdentityInput && hasLoginPurpose);
    if (isLoginForm && !hasSubstantiveContentOutsideBarrier(content, formMatch[0] ?? '')) {
      return true;
    }
  }

  if (status !== 401) return false;
  const text = visibleText(content);
  return (
    /\b(?:authentication|sign[ -]?in|log[ -]?in)\s+(?:is\s+)?required\b|\bplease\s+(?:sign|log)\s+in\s+to\s+continue\b|(?:请|需要|必须)登录|登录后(?:查看|继续)/iu.test(
      text,
    ) && !hasSubstantiveReadableContent(content)
  );
}

function looksLikeAccessChallenge(status: number, content: string): boolean {
  const hasProviderChallengeMarker =
    /(?:\bcf-(?:challenge|chl|turnstile)|\/cdn-cgi\/challenge-platform\/|\bg-recaptcha\b|\bh-captcha\b|\bpx-captcha\b|\barkose(?:labs)?\b|\bdatadome\b|\bperimeterx\b|_Incapsula_Resource)/iu.test(
      content,
    );
  const challengeForm =
    /<form\b[^>]*(?:\baction|\bid|\bclass)\s*=\s*["'][^"']*(?:captcha|challenge|verify)[^"']*["'][^>]*>[\s\S]*?<\/form>/iu.exec(
      content,
    );
  const hasChallengeLanguage =
    /\b(?:verify(?:ing)? you are human|checking your browser|security check|complete the challenge|enable javascript and cookies to continue)\b/iu.test(
      visibleText(content),
    );

  const isChallengeCandidate =
    (hasProviderChallengeMarker && (status === 403 || hasChallengeLanguage)) ||
    (challengeForm !== null && hasChallengeLanguage);
  return (
    isChallengeCandidate && !hasSubstantiveContentOutsideBarrier(content, challengeForm?.[0] ?? '')
  );
}

function hasSubstantiveContentOutsideBarrier(content: string, barrier: string): boolean {
  const outside = barrier ? content.replace(barrier, ' ') : content;
  return hasSubstantiveReadableContent(outside);
}

function hasSubstantiveReadableContent(content: string): boolean {
  const semanticRegions = content.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/giu);
  for (const region of semanticRegions) {
    if (visibleText(region[2] ?? '').length >= 40) return true;
  }
  return visibleText(content).length >= 80;
}

function looksLikeDynamicHtmlShell(content: string): boolean {
  if (!hasExecutableApplicationScript(content)) return false;

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(content)?.[1] ?? content;
  const bodyText = visibleText(body);
  const hasOnlyShellText =
    bodyText.length === 0 ||
    /^(?:loading(?:\.{0,3})?|please wait(?:\.{0,3})?|加载中(?:\.{0,3}|…)?|请稍候(?:\.{0,3}|…)?)$/iu.test(
      bodyText,
    );
  if (!hasOnlyShellText) return false;

  const applicationRoots = content.matchAll(
    /<(div|main)\b([^>]*\bid\s*=\s*["'](?:root|app|app-root|__next|__nuxt)["'][^>]*)>([\s\S]*?)<\/\1>/giu,
  );
  for (const rootMatch of applicationRoots) {
    if (isEffectivelyEmptyHtml(rootMatch[3] ?? '')) return true;
  }

  return isEffectivelyEmptyHtml(
    body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ''),
  );
}

function hasExecutableApplicationScript(content: string): boolean {
  const scripts = content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu);
  for (const scriptMatch of scripts) {
    const attributes = scriptMatch[1] ?? '';
    const body = scriptMatch[2] ?? '';
    const type = /\btype\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]?.toLowerCase();
    if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) {
      continue;
    }

    const src = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (src) {
      if (
        !/(?:analytics|google-analytics|googletagmanager|gtag|segment|plausible|matomo|hotjar|clarity|mixpanel|amplitude|newrelic|sentry|pixel)/iu.test(
          src,
        )
      ) {
        return true;
      }
      continue;
    }

    if (
      /(?:\bcreateRoot\s*\(|\bhydrateRoot\s*\(|ReactDOM\.render\s*\(|\bcreateApp\s*\(|\bnew\s+Vue\s*\(|document\.(?:getElementById|querySelector)\s*\()/u.test(
        body,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isEffectivelyEmptyHtml(content: string): boolean {
  return (
    content
      .replace(/<!--[\s\S]*?-->/gu, '')
      .replace(/<[^>]+>/gu, '')
      .replace(/&nbsp;|&#160;|&#x0*a0;/giu, '')
      .replace(/\s+/gu, '') === ''
  );
}

function visibleText(content: string): string {
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function createScopedAbortSignal(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (upstream?.aborted) abort();
  upstream?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', abort);
    },
  };
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

/**
 * The addresses where a cloud provider hands out the credentials of the machine. `web_fetch` reaches
 * localhost and the intranet on purpose, but a page that bounces the model to these would read the
 * instance's role credentials into its context. (A name that merely resolves here is not caught.)
 */
export function isCloudMetadataHost(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    /^169\.254\.\d{1,3}\.\d{1,3}$/u.test(host) ||
    host === 'fd00:ec2::254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host === '100.100.100.200'
  );
}

function normalizeHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function isTextLikeContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  return TEXT_CONTENT_TYPE_PATTERNS.some((pattern) => pattern.test(contentType));
}

async function readLimitedResponseText(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { text: '', bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      const next = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(next);
      bytes += next.byteLength;
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(concatChunks(chunks, bytes));
  return { text, bytes, truncated };
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function failure(
  message: string,
  res?: Response,
  contentType?: string,
  retrievalOutcome: LocalWebFetchRetrievalOutcome = 'network_error',
  retryAfter?: string,
): {
  content?: string;
  status?: number;
  statusText?: string;
  finalUrl?: string;
  contentType?: string;
  retryAfter?: string;
  retrievalOutcome: LocalWebFetchRetrievalOutcome;
  base_resp: { status_code: number; status_msg: string };
} {
  return {
    content: message,
    ...(res
      ? {
          status: res.status,
          statusText: res.statusText,
          finalUrl: res.url,
        }
      : {}),
    ...(contentType ? { contentType } : {}),
    ...(retryAfter ? { retryAfter } : {}),
    retrievalOutcome,
    base_resp: { status_code: res?.status || 1, status_msg: message },
  };
}
