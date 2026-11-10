/**
 * alran-widget DSL types — shared contract between daemon (persistence)
 * and UI (parsing + rendering).
 */

export type AlranWidgetKind =
  | 'chart'
  | 'map'
  | 'dashboard'
  | 'diagram'
  | 'interactive'
  | 'form'
  | 'mockup';

export type AlranWidgetStreamingMode = 'html-first' | 'complete' | 'static';

export type AlranWidgetThemeMode = 'app' | 'light' | 'dark' | 'isolated';

export type AlranWidgetCapability =
  | 'resize'
  | 'sendPrompt'
  | 'openLink'
  | 'download'
  | 'submitForm';

export type AlranWidgetPolicy = 'local-only' | 'inline-only' | 'trusted-cdn';

export interface AlranWidgetData {
  name: string;
  type: string;
  content: string;
}

export interface AlranWidgetEnvelope {
  version: string;
  kind: AlranWidgetKind;
  title: string;
  id?: string;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  streaming: AlranWidgetStreamingMode;
  capabilities?: AlranWidgetCapability[];
  theme?: AlranWidgetThemeMode;
  tokenSet?: string;
  policy?: AlranWidgetPolicy;

  meta?: string;
  style?: string;
  html?: string;
  data?: AlranWidgetData[];
  script?: string;
  fallback?: string;
}

export type WidgetContentSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; envelope: AlranWidgetEnvelope }
  | { type: 'widget_incomplete'; raw: string };
