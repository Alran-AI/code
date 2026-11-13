import { isBuiltIn, type StoreItem } from './application.js';
import type { PluginInspection, SkillInspection } from './inspect.js';

/** `[*]` on, `[-]` installed but off, `[ ]` not installed, `[!]` the name is taken by something else. */
export function itemMarker(item: StoreItem): string {
  if (item.conflict) return '[!]';
  if (!item.installed) return '[ ]';
  return item.enabled ? '[*]' : '[-]';
}

export function itemState(item: StoreItem): string {
  if (isBuiltIn(item)) return 'built in';
  if (item.conflict) return 'installed outside the Store';
  if (!item.installed) return 'available';
  if (item.updateAvailable) return `update available (${item.installedVersion ?? '?'} → ${item.version ?? '?'})`;
  if (item.kind === 'plugin' && !item.enabled) return 'installed, disabled';
  return 'installed';
}

/** The name as typed to select it: `name`, or `name@origin` when the origin is not the default. */
export function itemSelector(item: StoreItem): string {
  return item.origin === 'ottili' || isBuiltIn(item) ? item.name : `${item.name}@${item.origin}`;
}

/** Breaks `text` at spaces into lines of at most `width` columns, each starting with `indent`. */
export function wrapText(text: string, width: number, indent = ''): string[] {
  const room = Math.max(20, width - indent.length);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(`${indent}${line}`);
  return lines;
}

export function truncate(text: string, width: number): string {
  if (width <= 1) return text.slice(0, Math.max(0, width));
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/** A padded table of items for a terminal of `width` columns. */
export function formatItemTable(items: readonly StoreItem[], width = 100): string {
  if (items.length === 0) return '';
  const selectors = items.map(itemSelector);
  const nameWidth = Math.min(34, Math.max(...selectors.map((selector) => selector.length)));
  const versionWidth = Math.max(...items.map((item) => (item.version ?? '').length), 5);
  return items
    .map((item, index) => {
      const head = `${itemMarker(item)} ${truncate(selectors[index] ?? '', nameWidth).padEnd(nameWidth)}  ${(item.version ?? '').padEnd(versionWidth)}  `;
      const state = item.installed || item.conflict ? `  ${itemState(item)}` : '';
      const room = Math.max(10, width - head.length - state.length);
      return `${head}${truncate(item.description, room)}${state}`;
    })
    .join('\n');
}

/** Everything a person should read before installing, as plain lines. */
export function formatItemDetail(
  item: StoreItem,
  inspection?: PluginInspection | SkillInspection,
  width = 100,
): string {
  const lines = [
    `${item.displayName} (${itemSelector(item)})`,
    `  ${itemState(item)}${item.version ? ` · version ${item.version}` : ''}`,
    '',
    ...wrapText(item.description, width, '  '),
    '',
  ];
  const facts: [string, string | undefined][] = [
    ['Kind', item.kind === 'plugin' ? 'Plugin' : 'Skill'],
    ['From', item.origin],
    ['Author', item.author],
    [item.kind === 'plugin' ? 'Category' : 'Group', item.group],
    ['License', item.license],
    ['Contains', item.summary],
  ];
  for (const [label, value] of facts) if (value) lines.push(`  ${`${label}:`.padEnd(10)}${value}`);
  const entry = item.entry;
  if (entry?.kind === 'plugin') {
    if (entry.homepage) lines.push(`  ${'Homepage:'.padEnd(10)}${entry.homepage}`);
    if (entry.contents.skills.length > 0) {
      lines.push('', '  Skills:');
      for (const skill of entry.contents.skills) lines.push(`    ${skill.name}`);
    }
    if (entry.exampleQueries.length > 0) {
      lines.push('', '  Try:');
      for (const query of entry.exampleQueries) lines.push(`    “${query}”`);
    }
  }
  if (inspection && inspection.executes.length > 0) {
    lines.push('', ...formatConsent(inspection.executes.map((note) => note.line)).split('\n'));
  }
  return lines.join('\n');
}

export function formatConsent(lines: readonly string[]): string {
  return ['  This package will run commands or connect to services:', ...lines.map((line) => `    • ${line}`)].join('\n');
}

const score = (haystack: string, token: string, weight: number): number => {
  const text = haystack.toLowerCase();
  if (text === token) return weight * 4;
  if (text.startsWith(token)) return weight * 3;
  if (text.includes(token)) return weight * 2;
  return 0;
};

/**
 * Items matching every word of `query` in their name, title, group, author or description,
 * best match first (name before title before description); stable for equal scores. An empty
 * query returns the items unchanged.
 */
export function searchItems(items: readonly StoreItem[], query: string): StoreItem[] {
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...items];
  const ranked: { item: StoreItem; points: number; index: number }[] = [];
  items.forEach((item, index) => {
    let points = 0;
    for (const token of tokens) {
      const found =
        score(item.name, token, 50) +
        score(item.displayName, token, 30) +
        score(item.group ?? '', token, 10) +
        score(item.author ?? '', token, 5) +
        score(item.description, token, 1);
      if (found === 0) return;
      points += found;
    }
    ranked.push({ item, points, index });
  });
  return ranked.sort((left, right) => right.points - left.points || left.index - right.index).map(({ item }) => item);
}
