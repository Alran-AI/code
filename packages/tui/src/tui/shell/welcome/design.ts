export const ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT = '{paste-image-shortcut}';
const ALRAN_CODE_WELCOME_CHECKIN_TIP = '/checkin claims the daily reward.';

export const ALRAN_CODE_WELCOME_DESIGN = {
  sectionTitles: {
    tips: 'Tips for getting started',
    news: "What's new · /changelog for history",
  },
  tipPool: [
    'Say what you want and how to verify it.',
    `Use @ for files; ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
    'Run /init to teach Alran this repo.',
    'Use /plan before a change that needs design or investigation.',
    'Use /context to check the current Session context budget.',
    'Use /sessions to resume earlier work.',
    'Use /history to review and branch from earlier prompts.',
    'Use /goal to keep long-running work focused on a finish line.',
    'Use /permission to choose how Alran handles tool approvals.',
    'Use /feedback to preview a redacted report before upload.',
    ALRAN_CODE_WELCOME_CHECKIN_TIP,
  ],
  wide: {
    tips: [
      'Say what you want and how to verify it.',
      `Use @ for files; ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
      'Run /init to teach Alran this repo.',
      ALRAN_CODE_WELCOME_CHECKIN_TIP,
    ],
    news: [
      'Send follow-ups while Alran works.',
      '/context shows read-only session context.',
      '/feedback previews before upload.',
    ],
  },
  stacked: {
    tips: [
      'Say what you want and how to verify it.',
      `@ files · ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} images · /init guidance`,
      '/checkin daily reward',
    ],
    news: ['Follow-ups wait while Alran works.', '/context budget · /feedback preview'],
  },
  compact: {
    tips: [
      `@ files · ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} images`,
      '/init repo guidance',
      '/checkin reward',
    ],
    news: ['Follow-ups wait', '/context · /feedback'],
  },
  hero: {
    fullMinWidth: 79,
    mediumMinWidth: 44,
    microMinWidth: 11,
    fallbackTitle: 'ALRAN',
  },
} as const;

/**
 * Brand purple ramp for the ALRAN CODE wordmark, applied from the top line to
 * the bottom line. It lives here instead of in the shared palettes so the light
 * and the dark appearance render the same brand purple.
 */
export const ALRAN_CODE_WORDMARK_GRADIENT = {
  start: '#4c1d95',
  end: '#a855f7',
} as const;

/** Tagline rendered centered underneath the full wordmark. */
export const ALRAN_CODE_WELCOME_TAGLINE = 'Powered by Ottili AI Platform';

export const ALRAN_CODE_TERMINAL_WORDMARK = [
  ' █████╗ ██╗     ██████╗  █████╗ ███╗   ██╗     ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██║     ██╔══██╗██╔══██╗████╗  ██║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '███████║██║     ██████╔╝███████║██╔██╗ ██║    ██║     ██║   ██║██║  ██║█████╗',
  '██╔══██║██║     ██╔══██╗██╔══██║██║╚██╗██║    ██║     ██║   ██║██║  ██║██╔══╝',
  '██║  ██║███████╗██║  ██║██║  ██║██║ ╚████║    ╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
] as const;

export const ALRAN_CODE_TERMINAL_MEDIUM_WORDMARK = ['ALRAN'] as const;

export const ALRAN_CODE_TERMINAL_MICRO_WORDMARK = ['ALRAN'] as const;
