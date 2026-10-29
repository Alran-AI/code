export const ALRAN_CODE_WELCOME_PASTE_IMAGE_SHORTCUT = '{paste-image-shortcut}';

export const ALRAN_CODE_WELCOME_DESIGN = {
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
