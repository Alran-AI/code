/** The default title given to newly created or promoted root sessions. */
export const DEFAULT_ROOT_SESSION_TITLE = 'Main';

const ARCHIVED_SESSION_TITLE_PREFIX = 'Memory archive: ';

/** Build the synchronous archive fallback; V2 owns model-generated titles. */
export function buildArchivedRootSessionTitle(opts: {
  oldTitle?: string | null;
  fallbackName: string;
  locale?: string;
}): string {
  const oldTitle = opts.oldTitle?.trim() ?? '';
  const label =
    !oldTitle || oldTitle.toLowerCase() === DEFAULT_ROOT_SESSION_TITLE.toLowerCase()
      ? opts.fallbackName
      : oldTitle;
  return `${ARCHIVED_SESSION_TITLE_PREFIX}${label}`;
}
