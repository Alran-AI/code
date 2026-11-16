import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { classifyLLMErrorToCode, LLM_ERROR_CODES } from '@alran/shared/llm-error-classifier';
import { logger } from '@alran/shared/local-runtime-logging';

const BYOK_ERROR_PREFIX = 'BYOK upstream error';
const MAX_ERROR_MESSAGE_LENGTH = 1_200;

export function withByokErrorAttribution(input: {
  readonly streamFn?: StreamFn;
  readonly providerId: string;
}): StreamFn {
  const base = input.streamFn ?? streamSimple;
  return (async (model, context, options) => {
    const attribution = createAttribution(options);
    try {
      const stream = await base(model, context, attribution.options);
      return wrapStream(stream, input.providerId, options?.signal, attribution);
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      throw new Error(formatByokErrorMessage(error, input.providerId, attribution));
    }
  }) as StreamFn;
}

type StreamOptions = Parameters<StreamFn>[2];

interface Attribution {
  /** The stream options to hand to the provider: the caller's, plus the error observer. */
  readonly options: StreamOptions;
  /** The transport cause of the failure the provider client reported, when it had one. */
  cause(): string | undefined;
  /** Writes the failure to the runtime log, once per request however many readers see it. */
  report(providerId: string, errorCode: number, detail: string): void;
}

/**
 * The provider client keeps only the text of a failure ("Connection error."), but hands
 * the original exception to `onProviderError` first. Keep a reference so the cause chain
 * (refused address, unresolved host, certificate problem) can be added to that text.
 */
function createAttribution(options: StreamOptions): Attribution {
  let observed: unknown;
  let reported = false;
  const callerOnProviderError = options?.onProviderError;
  return {
    options: {
      ...options,
      onProviderError(error: unknown, observedModel: Parameters<NonNullable<typeof callerOnProviderError>>[1]): void {
        observed = error;
        callerOnProviderError?.(error, observedModel);
      },
    },
    cause: () => transportCause(observed),
    report(providerId, errorCode, detail) {
      if (reported) return;
      reported = true;
      // The detail is already redacted; the user sees the same text in the failed turn.
      logger.warn(
        { provider_id: providerId, error_code: errorCode, error_detail: detail },
        '[byok] upstream request failed',
      );
    },
  };
}

/** How deep the cause chain is searched (client error, fetch failure, system error, ...). */
const TRANSPORT_CAUSE_DEPTH = 5;

/**
 * The underlying transport failure of an error without an HTTP status: the first nested
 * cause that carries a system or TLS code. Its message names the address or host that
 * failed, never a path or a credential.
 */
function transportCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (typeof (error as { status?: unknown }).status === 'number') return undefined;
  let current: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; depth < TRANSPORT_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const found = describeCodedError(current);
    if (found) return found;
    const nested = (current as { errors?: unknown }).errors;
    const first = Array.isArray(nested) ? (nested[0] as unknown) : undefined;
    const fromAggregate = first instanceof Error ? describeCodedError(first) : undefined;
    if (fromAggregate) return fromAggregate;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function describeCodedError(error: Error): string | undefined {
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string' || code === '') return undefined;
  const message = error.message.trim();
  if (message === '') return code;
  return message.includes(code) ? message : `${message} [${code}]`;
}

function formatByokErrorMessage(raw: unknown, providerId: string, attribution?: Attribution): string {
  const original = errorText(raw);
  if (original.startsWith(BYOK_ERROR_PREFIX)) return original;
  const cause = attribution?.cause();
  const rawMessage = cause && !original.includes(cause) ? `${original} (${cause})` : original;
  const classified = classifyLLMErrorToCode(typeof raw === 'string' || raw instanceof Error ? rawMessage : raw);
  const detail = redactByokErrorMessage(
    withHttpStatus(classified?.message ?? rawMessage, rawMessage) || 'LLM provider request failed',
  );
  const errorCode = classified?.status_code ?? LLM_ERROR_CODES.LLM_UPSTREAM_ERROR;
  attribution?.report(providerId, errorCode, detail);
  return `${BYOK_ERROR_PREFIX}: ${JSON.stringify({
    errorCode,
    message: `BYOK provider ${providerId} upstream error: ${detail}`,
    errorSource: 'byok_upstream',
    errorDetail: detail,
    errorProviderId: providerId,
  })}`;
}

/**
 * A JSON error body reduces to its inner `message`, which drops the HTTP status
 * (`413 {"type":"error",…}` becomes the bare sentence). Request-size recovery and
 * retry classification read this text and recognize the status, so keep it.
 */
function withHttpStatus(detail: string, rawMessage: string): string {
  const status = /^([1-5]\d\d) /u.exec(rawMessage)?.[1];
  return status && detail && !detail.startsWith(`${status} `) ? `${status} ${detail}` : detail;
}

function redactByokErrorMessage(message: string): string {
  return message
    .slice(0, MAX_ERROR_MESSAGE_LENGTH)
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/gu, 'sk-***')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/giu, '$1***')
    .replace(/((?:api[_-]?key|x-api-key)\s*[:=]\s*)[^\s"',}]+/giu, '$1***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu, '$1***');
}

function wrapStream(
  stream: AssistantMessageEventStream,
  providerId: string,
  signal: AbortSignal | undefined,
  attribution: Attribution,
): AssistantMessageEventStream {
  const wrapped: AssistantMessageEventStream = Object.create(stream);
  Object.defineProperty(wrapped, Symbol.asyncIterator, {
    value: () => attributedEvents(stream, providerId, signal, attribution),
  });
  Object.defineProperty(wrapped, 'result', {
    value: () => attributedResult(stream, providerId, signal, attribution),
  });
  return wrapped;
}

async function* attributedEvents(
  stream: AssistantMessageEventStream,
  providerId: string,
  signal: AbortSignal | undefined,
  attribution: Attribution,
): AsyncGenerator<AssistantMessageEvent> {
  try {
    for await (const event of stream) {
      yield attributeEvent(event, providerId, attribution);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(formatByokErrorMessage(error, providerId, attribution));
  }
}

async function attributedResult(
  stream: AssistantMessageEventStream,
  providerId: string,
  signal: AbortSignal | undefined,
  attribution: Attribution,
): Promise<AssistantMessage> {
  try {
    return attributeMessage(await stream.result(), providerId, attribution);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(formatByokErrorMessage(error, providerId, attribution));
  }
}

function attributeEvent(
  event: AssistantMessageEvent,
  providerId: string,
  attribution: Attribution,
): AssistantMessageEvent {
  return event.type === 'error' && event.reason === 'error'
    ? { ...event, error: attributeMessage(event.error, providerId, attribution) }
    : event;
}

function attributeMessage(
  message: AssistantMessage,
  providerId: string,
  attribution: Attribution,
): AssistantMessage {
  return message.stopReason === 'error' && message.errorMessage
    ? {
        ...message,
        errorMessage: formatByokErrorMessage(message.errorMessage, providerId, attribution),
      }
    : message;
}

function errorText(raw: unknown): string {
  if (raw instanceof Error) return raw.message;
  return typeof raw === 'string' ? raw : '';
}
