// Changelog counting for the one-line auto-update announcement.
//
// The counts in "Updated to 1.1.x – N features, M fixes" come from the CHANGELOG.md that ships
// inside the installed package (the same text GitHub renders on the release page), never from the
// network: the only request auto-update makes is the npm registry version lookup. Two layouts are
// recognized — conventional-commit bullets (`feat: …`, `fix(scope): …`) and Keep-a-Changelog
// sections (`### Added`, `### Fixed`). When no counts can be derived the announcement falls back to
// the version and the changelog link alone.

export interface AlranChangelogCounts {
  readonly features: number;
  readonly fixes: number;
}

const VERSION_HEADING = /^#{1,3}\s*(?:\[?)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)(?:\])?(?:\s|$)/u;
const FEAT_PREFIX = /^\s*(?:[-*]\s+)?feat(?:\([^)]*\))?!?:/u;
const FIX_PREFIX = /^\s*(?:[-*]\s+)?fix(?:\([^)]*\))?!?:/u;
const SECTION_HEADING = /^###\s+(.+?)\s*$/u;
const ADDED_SECTIONS = new Set(['added', 'features', 'feat', 'feature']);
const FIXED_SECTIONS = new Set(['fixed', 'fixes', 'fix', 'bug fix', 'bug fixes']);

/**
 * Count the `feat`/`fix` entries of one version's CHANGELOG section.
 *
 * Conventional prefixes win; a section whose entries carry no prefixes falls back to counting the
 * bullets of `### Added` / `### Fixed` headings, which is how this repository writes its changelog.
 */
export function countAlranChangelogEntries(
  changelog: string,
  version: string,
): AlranChangelogCounts {
  const section = extractChangelogSection(changelog, version);
  if (!section) return { features: 0, fixes: 0 };
  const lines = section.split(/\r?\n/u);
  let features = 0;
  let fixes = 0;
  let prefixed = 0;
  for (const line of lines) {
    if (FEAT_PREFIX.test(line)) {
      features += 1;
      prefixed += 1;
      continue;
    }
    if (FIX_PREFIX.test(line)) {
      fixes += 1;
      prefixed += 1;
      continue;
    }
  }
  if (prefixed > 0) return { features, fixes };

  let added = false;
  let fixed = false;
  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      const name = heading[1].trim().toLocaleLowerCase();
      added = ADDED_SECTIONS.has(name);
      fixed = FIXED_SECTIONS.has(name);
      if (!added && !fixed) {
        added = false;
        fixed = false;
      }
      continue;
    }
    if (!/^\s*(?:[-*]\s+|\d+\.\s+)\S/u.test(line)) continue;
    if (added) features += 1;
    else if (fixed) fixes += 1;
  }
  return { features, fixes };
}

function extractChangelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    const match = VERSION_HEADING.exec(line);
    return match?.[1] === version;
  });
  if (start < 0) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && /^#{1,2}\s+\S/u.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The GitHub release-notes link of an installed version. */
export function alranReleaseLink(version: string): string {
  return `https://github.com/Alran-AI/code/releases/tag/v${version}`;
}

/**
 * The single announcement line shown once after an update becomes active.
 * Counts are omitted when the changelog yields none.
 */
export function renderAutoUpdateAnnouncement(
  version: string,
  counts: AlranChangelogCounts,
): string {
  const link = alranReleaseLink(version);
  if (counts.features <= 0 && counts.fixes <= 0) {
    return `Updated to ${version}. Changelog: ${link}`;
  }
  const parts: string[] = [];
  if (counts.features > 0) parts.push(`${String(counts.features)} feature${counts.features === 1 ? '' : 's'}`);
  if (counts.fixes > 0) parts.push(`${String(counts.fixes)} fix${counts.fixes === 1 ? '' : 'es'}`);
  return `Updated to ${version} – ${parts.join(', ')}. Changelog: ${link}`;
}
