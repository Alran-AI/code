import {
  ARCHIVE_SHA256_PATTERN,
  CONTENT_DIGEST_PATTERN,
  PLUGIN_CATEGORIES,
  PLUGIN_NAME_PATTERN,
  SEMVER_PATTERN,
  SKILL_NAME_PATTERN,
  STORE_INDEX_SCHEMA,
  STORE_LIMITS,
  StoreError,
  type PluginCategory,
  type StoreArchiveRef,
  type StoreIndex,
  type StorePluginContents,
  type StorePluginEntry,
  type StoreSkillEntry,
} from './contract.js';
import { ARCHIVE_LIMITS } from './archive.js';
import { oneLine } from './text.js';

type Json = Record<string, unknown>;

/**
 * Parses and validates a store index. `baseUrl` is the absolute URL (a `file:` URL for a local
 * index) the index was read from; archive URLs that are relative are resolved against it. Throws
 * `StoreError('INDEX_INVALID')`
 * with a path to the offending field, so a store author can find it.
 */
export function parseStoreIndex(text: string, baseUrl: string): StoreIndex {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw invalid('', `is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  const root = record(document, '');
  if (root.schema !== STORE_INDEX_SCHEMA) {
    throw invalid('schema', `must be "${STORE_INDEX_SCHEMA}"`);
  }
  const plugins = array(root.plugins ?? [], 'plugins').map((item, index) =>
    readPlugin(item, `plugins[${index}]`, baseUrl),
  );
  const skills = array(root.skills ?? [], 'skills').map((item, index) =>
    readSkill(item, `skills[${index}]`, baseUrl),
  );
  if (plugins.length + skills.length > STORE_LIMITS.entries) {
    throw invalid('', `holds more than ${STORE_LIMITS.entries} entries`);
  }
  assertUnique(plugins.map((plugin) => plugin.name), 'plugins');
  assertUnique(skills.map((skill) => skill.name), 'skills');
  const description = optionalText(root.description, 'description', 2_000);
  const updatedAt = optionalText(root.updatedAt, 'updatedAt', 64);
  return {
    schema: STORE_INDEX_SCHEMA,
    name: text1(root.name, 'name', 80),
    ...(description ? { description } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    plugins,
    skills,
  };
}

function readPlugin(value: unknown, at: string, baseUrl: string): StorePluginEntry {
  const item = record(value, at);
  const name = text1(item.name, `${at}.name`, 80);
  if (!PLUGIN_NAME_PATTERN.test(name)) throw invalid(`${at}.name`, 'is not a Plugin name');
  const category = text1(item.category, `${at}.category`, 64);
  if (!(PLUGIN_CATEGORIES as readonly string[]).includes(category)) {
    throw invalid(`${at}.category`, `must be one of ${PLUGIN_CATEGORIES.join(', ')}`);
  }
  const license = optionalText(item.license, `${at}.license`, 128);
  const homepage = optionalHttpsUrl(item.homepage, `${at}.homepage`);
  return {
    kind: 'plugin',
    name,
    displayName: optionalText(item.displayName, `${at}.displayName`, 200) ?? name,
    version: version(item.version, `${at}.version`),
    description: text1(item.description, `${at}.description`, 2_000),
    author: text1(item.author, `${at}.author`, 200),
    category: category as PluginCategory,
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    exampleQueries: array(item.exampleQueries ?? [], `${at}.exampleQueries`)
      .slice(0, 3)
      .map((query, index) => text1(query, `${at}.exampleQueries[${index}]`, 500)),
    contents: readContents(item.contents, `${at}.contents`),
    archive: readArchive(item.archive, `${at}.archive`, baseUrl),
  };
}

function readContents(value: unknown, at: string): StorePluginContents {
  const item = record(value, at);
  return {
    skills: array(item.skills ?? [], `${at}.skills`).map((skill, index) => {
      const entry = record(skill, `${at}.skills[${index}]`);
      const description = optionalText(entry.description, `${at}.skills[${index}].description`, 4_000);
      return {
        name: text1(entry.name, `${at}.skills[${index}].name`, 80),
        ...(description ? { description } : {}),
      };
    }),
    mcpServers: array(item.mcpServers ?? [], `${at}.mcpServers`).map((name, index) =>
      text1(name, `${at}.mcpServers[${index}]`, 80),
    ),
    apps: array(item.apps ?? [], `${at}.apps`).map((name, index) =>
      text1(name, `${at}.apps[${index}]`, 80),
    ),
    hooks: integer(item.hooks ?? 0, `${at}.hooks`, 0, 64),
  };
}

function readSkill(value: unknown, at: string, baseUrl: string): StoreSkillEntry {
  const item = record(value, at);
  const name = text1(item.name, `${at}.name`, 64);
  if (!SKILL_NAME_PATTERN.test(name)) throw invalid(`${at}.name`, 'is not a Skill name');
  const author = optionalText(item.author, `${at}.author`, 200);
  const license = optionalText(item.license, `${at}.license`, 128);
  return {
    kind: 'skill',
    name,
    title: optionalText(item.title, `${at}.title`, 200) ?? name,
    version: version(item.version, `${at}.version`),
    description: text1(item.description, `${at}.description`, 4_000),
    group: text1(item.group, `${at}.group`, 80),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    files: integer(item.files, `${at}.files`, 1, ARCHIVE_LIMITS.files),
    archive: readArchive(item.archive, `${at}.archive`, baseUrl),
  };
}

function readArchive(value: unknown, at: string, baseUrl: string): StoreArchiveRef {
  const item = record(value, at);
  const rawUrl = text1(item.url, `${at}.url`, 2_048);
  let resolved: URL;
  try {
    resolved = new URL(rawUrl, baseUrl);
  } catch {
    throw invalid(`${at}.url`, 'is not a URL');
  }
  // An index read over the network must not make the client read local files.
  const remote = /^https?:$/u.test(new URL(baseUrl).protocol);
  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:' && resolved.protocol !== 'file:') {
    throw invalid(`${at}.url`, 'must be an https or file URL');
  }
  if (remote && resolved.protocol === 'file:') {
    throw invalid(`${at}.url`, 'must not be a file URL in an index that was fetched');
  }
  const url = resolved.toString();
  const archiveSha256 = text1(item.archiveSha256, `${at}.archiveSha256`, 64);
  if (!ARCHIVE_SHA256_PATTERN.test(archiveSha256)) {
    throw invalid(`${at}.archiveSha256`, 'must be 64 lowercase hex digits');
  }
  const contentDigest = text1(item.contentDigest, `${at}.contentDigest`, 80);
  if (!CONTENT_DIGEST_PATTERN.test(contentDigest)) {
    throw invalid(`${at}.contentDigest`, 'must be sha256-tree-v1:<64 lowercase hex digits>');
  }
  return {
    url,
    size: integer(item.size, `${at}.size`, 22, ARCHIVE_LIMITS.archiveBytes),
    archiveSha256,
    contentDigest,
  };
}

function version(value: unknown, at: string): string {
  const text = text1(value, at, 128);
  if (!SEMVER_PATTERN.test(text)) throw invalid(at, 'must be a SemVer version');
  return text;
}

function record(value: unknown, at: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(at, 'must be an object');
  }
  return value as Json;
}

function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(at, 'must be an array');
  return value;
}

function text1(value: unknown, at: string, max: number): string {
  if (typeof value !== 'string') throw invalid(at, 'must be a string');
  const text = oneLine(value);
  if (!text) throw invalid(at, 'must not be empty');
  if (text.length > max) throw invalid(at, `must be at most ${max} characters`);
  return text;
}

function optionalText(value: unknown, at: string, max: number): string | undefined {
  return value === undefined ? undefined : text1(value, at, max);
}

function optionalHttpsUrl(value: unknown, at: string): string | undefined {
  if (value === undefined) return undefined;
  const text = text1(value, at, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw invalid(at, 'is not a URL');
  }
  if (parsed.protocol !== 'https:') throw invalid(at, 'must be an https URL');
  return parsed.toString();
}

function integer(value: unknown, at: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(at, `must be an integer from ${min} to ${max}`);
  }
  return value;
}

function assertUnique(names: readonly string[], at: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw invalid(at, `lists "${name}" twice`);
    seen.add(name);
  }
}

function invalid(at: string, problem: string): StoreError {
  return new StoreError('INDEX_INVALID', `Store index ${at ? `field ${at} ` : ''}${problem}.`);
}
