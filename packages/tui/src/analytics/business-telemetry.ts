import { randomUUID } from 'node:crypto';
import type { AlranBuildEnv, AlranRegion } from '@alran/config';

export type AlranChatType = 'chat' | 'agent_team' | 'claw' | 'hermes' | 'IM';
export type AlranLoginSource =
  | 'agent_web'
  | 'agent_desktop'
  | 'openplatform'
  | 'alran_tui'
  | 'alran_cli';
export type AlranLoginFailReason = '' | '1' | '2' | '3' | '4' | '5';
export type AlranSlashCommandType =
  | 'skill'
  | 'new_chat'
  | 'summarize'
  | 'plan_mode'
  | 'goal_mode'
  | 'other';
export type AlranAtCommandType = 'plugins' | 'goal_mode' | 'plan_mode' | 'file' | 'directory';
export type AlranDurationBucket =
  'not_applicable' | 'under_1m' | '1m_to_5m' | '5m_to_30m' | 'over_30m';

interface ChatContextProperties {
  readonly chat_type: AlranChatType;
}

export interface AlranBusinessEventMap {
  readonly tui_launch: { readonly launch_type: 'cold' | 'hot' };
  readonly login_click: Record<string, never>;
  readonly logout_click: Record<string, never>;
  readonly login_result: {
    readonly source: AlranLoginSource;
    readonly result_type: '1' | '2';
    readonly fail_reason: AlranLoginFailReason;
    readonly login_type: 'google' | 'mobile' | 'wechat' | 'apple' | 'alran_sso' | 'alran_oauth';
  };
  readonly btw_session_lifecycle: {
    readonly phase: 'opened' | 'closed';
    readonly duration_bucket: AlranDurationBucket;
    readonly exit_reason: '' | 'ctrl_c' | 'ctrl_d' | 'navigation' | 'replaced';
  };
  /**
   * TUI-only metric, in the shape Desktop used before it moved to the
   * `prompt_suggestion_*` events. The text is never reported.
   */
  readonly prompt_suggestion: {
    readonly session_id: string;
    readonly turn_id: string;
    readonly prompt_version: string;
    readonly elapsed_ms: number;
    readonly action: 'shown' | 'accepted' | 'sent';
    readonly edited?: boolean;
  };
  readonly chat_send: ChatContextProperties & {
    readonly is_first_message: 0 | 1;
    readonly is_attachment: 'text' | 'attachment';
  };
  readonly slash_command_menu_view: ChatContextProperties;
  readonly slash_command_click: ChatContextProperties & {
    readonly command_type: AlranSlashCommandType;
  };
  readonly at_command_menu_view: ChatContextProperties;
  readonly at_command_click: ChatContextProperties & {
    readonly command_type: AlranAtCommandType;
  };
}

export type AlranBusinessEventName = keyof AlranBusinessEventMap;
export type AlranBusinessEvent = {
  [Event in AlranBusinessEventName]: {
    readonly event: Event;
    readonly properties: AlranBusinessEventMap[Event];
  };
}[AlranBusinessEventName];

export interface AlranBusinessTelemetry {
  track<Event extends AlranBusinessEventName>(
    event: Event,
    properties: AlranBusinessEventMap[Event],
  ): void;
  flush(): Promise<void>;
}

export interface CreateAlranBusinessTelemetryOptions {
  readonly region: AlranRegion;
  readonly buildEnv: AlranBuildEnv;
  readonly version: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly queueLimit?: number;
  readonly timeoutMs?: number;
  /** The environment the reporting endpoint is read from (`ALRAN_TELEMETRY_ENDPOINT`). */
  readonly environment?: NodeJS.ProcessEnv;
}

export interface AlranTelemetryPolicy {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly blockedBy?: 'ALRAN_DISABLE_TELEMETRY' | 'DO_NOT_TRACK';
}

export interface AlranBusinessTelemetryPreview {
  /** Where the request would go; null when no reporting endpoint is configured (the default). */
  readonly endpoint: string | null;
  readonly method: 'POST';
  readonly contentType: 'application/x-www-form-urlencoded';
  readonly payload: SensorsPayload;
}

export interface SensorsPayload {
  readonly identities: { readonly $identity_cookie_id: string };
  readonly distinct_id: string;
  readonly lib: {
    readonly $lib: 'js';
    readonly $lib_method: 'code';
    readonly $lib_version: string;
  };
  readonly properties: Record<string, unknown>;
  readonly type: 'track';
  readonly event: AlranBusinessEventName;
  readonly time: number;
}

const DEFAULT_QUEUE_LIMIT = 100;
const EVENT_PROPERTY_KEYS = {
  tui_launch: ['launch_type'],
  login_click: [],
  logout_click: [],
  login_result: ['source', 'result_type', 'fail_reason', 'login_type'],
  btw_session_lifecycle: ['phase', 'duration_bucket', 'exit_reason'],
  prompt_suggestion: [
    'session_id',
    'turn_id',
    'prompt_version',
    'elapsed_ms',
    'action',
    'edited',
  ],
  chat_send: ['chat_type', 'is_first_message', 'is_attachment'],
  slash_command_menu_view: ['chat_type'],
  slash_command_click: ['chat_type', 'command_type'],
  at_command_menu_view: ['chat_type'],
  at_command_click: ['chat_type', 'command_type'],
} as const satisfies {
  [Event in AlranBusinessEventName]: readonly Extract<keyof AlranBusinessEventMap[Event], string>[];
};

export function resolveAlranBusinessTelemetryPolicy(options: {
  readonly configEnabled?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}): AlranTelemetryPolicy {
  const environment = options.environment ?? process.env;
  const configured = options.configEnabled === true;
  if (isEnabledEnvironmentFlag(environment.ALRAN_DISABLE_TELEMETRY)) {
    return { enabled: false, configured, blockedBy: 'ALRAN_DISABLE_TELEMETRY' };
  }
  if (isEnabledEnvironmentFlag(environment.DO_NOT_TRACK)) {
    return { enabled: false, configured, blockedBy: 'DO_NOT_TRACK' };
  }
  return { enabled: configured, configured };
}

export function createAlranBusinessTelemetry(
  options: CreateAlranBusinessTelemetryOptions,
): AlranBusinessTelemetry {
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = resolveAlranBusinessTelemetryEndpoint(options.region, options.buildEnv, options.environment);
  const queueLimit = Math.max(1, options.queueLimit ?? DEFAULT_QUEUE_LIMIT);
  const queue: AlranBusinessEvent[] = [];
  let drainPromise: Promise<void> | undefined;
  let drainScheduled = false;

  const drain = async (): Promise<void> => {
    drainScheduled = false;
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      // No endpoint, no request: an event that has nowhere to go is dropped here.
      if (!endpoint) continue;
      try {
        const payload = createSensorsPayload(item, options);
        await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: encodeSensorsRequest(payload),
          signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
        });
      } catch {
        // Usage reporting must never affect the product flow.
      }
    }
  };

  const scheduleDrain = (): void => {
    if (drainScheduled || drainPromise) return;
    drainScheduled = true;
    queueMicrotask(() => {
      if (!drainScheduled || drainPromise) return;
      drainPromise = drain().finally(() => {
        drainPromise = undefined;
        if (queue.length > 0) scheduleDrain();
      });
    });
  };

  return {
    track(event, properties) {
      if (queue.length >= queueLimit) queue.shift();
      queue.push({ event, properties } as AlranBusinessEvent);
      scheduleDrain();
    },
    async flush() {
      drainScheduled = false;
      if (drainPromise) await drainPromise;
      if (queue.length > 0) await drain();
    },
  };
}

export function createAlranBusinessTelemetryPreview<Event extends AlranBusinessEventName>(
  event: Event,
  properties: AlranBusinessEventMap[Event],
  options: CreateAlranBusinessTelemetryOptions,
): AlranBusinessTelemetryPreview {
  return {
    endpoint: resolveAlranBusinessTelemetryEndpoint(options.region, options.buildEnv, options.environment) ?? null,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: createSensorsPayload({ event, properties } as AlranBusinessEvent, options),
  };
}

export function bucketAlranDuration(durationMs: number): AlranDurationBucket {
  if (durationMs < 60_000) return 'under_1m';
  if (durationMs < 5 * 60_000) return '1m_to_5m';
  if (durationMs < 30 * 60_000) return '5m_to_30m';
  return 'over_30m';
}

function createSensorsPayload(
  item: AlranBusinessEvent,
  options: CreateAlranBusinessTelemetryOptions,
): SensorsPayload {
  const eventProperties = selectEventProperties(item);
  // A fresh ID satisfies the receiver's envelope without linking separate events.
  const eventId = (options.randomId ?? randomUUID)();
  return {
    identities: { $identity_cookie_id: eventId },
    distinct_id: eventId,
    lib: { $lib: 'js', $lib_method: 'code', $lib_version: options.version },
    properties: {
      surface: 'tui',
      os: process.platform,
      region: options.region,
      build_env: options.buildEnv,
      app_version: options.version,
      ...eventProperties,
    },
    type: 'track',
    event: item.event,
    time: (options.now ?? Date.now)(),
  };
}

function selectEventProperties(item: AlranBusinessEvent): Record<string, string | number> {
  const selected: Record<string, string | number> = {};
  const properties = item.properties as Record<string, string | number>;
  for (const key of EVENT_PROPERTY_KEYS[item.event]) selected[key] = properties[key]!;
  return selected;
}

/** The environment variable that names the usage-reporting endpoint of a deployment. */
export const ALRAN_TELEMETRY_ENDPOINT_ENV = 'ALRAN_TELEMETRY_ENDPOINT';

/**
 * Where opt-in usage reporting is sent.
 *
 * Ottili operates no reporting endpoint for the CLI today, so there is no default: without
 * `ALRAN_TELEMETRY_ENDPOINT` nothing is sent, even when a user opted in. An endpoint must be https
 * (or loopback http, for a local test receiver). The endpoints this code base used to carry belonged
 * to the company it was derived from and are gone for good — a fork must never report to its origin.
 */
export function resolveAlranBusinessTelemetryEndpoint(
  _region: AlranRegion,
  _buildEnv: AlranBuildEnv,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = environment[ALRAN_TELEMETRY_ENDPOINT_ENV]?.trim();
  if (!configured) return undefined;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return undefined;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.toString();
  return undefined;
}

function isEnabledEnvironmentFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? '');
}

function encodeSensorsRequest(payload: SensorsPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return new URLSearchParams({ data, ext: `crc=${javaStringHash(data)}` }).toString();
}

function javaStringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash &= hash;
  }
  return hash;
}
