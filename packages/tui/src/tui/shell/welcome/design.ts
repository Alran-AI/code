export const ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT = '{paste-image-shortcut}';

export const ALRAN_CODE_WELCOME_DESIGN = {
  sectionTitles: {
    tips: 'Tips for getting started',
    news: "What's new · /changelog for history",
  },
  wide: {
    tips: [
      'Every change shows a diff — verify it before it applies.',
      `Use @ for files; ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
      'Run /init to teach Alran this repo.',
    ],
    news: [
      'Send follow-ups while Alran works — they queue until the turn ends.',
      '/context shows read-only session context.',
      '/feedback previews before upload.',
    ],
  },
  stacked: {
    tips: [
      'Every change shows a diff — verify it before it applies.',
      `@ files · ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} images · /init guidance`,
    ],
    news: ['Send follow-ups while Alran works — they queue until the turn ends.', '/context budget · /feedback preview'],
  },
  compact: {
    tips: [
      `@ files · ${ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT} images`,
      '/init repo guidance',
    ],
    news: ['Follow-ups queue while Alran works.', '/context · /feedback'],
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
