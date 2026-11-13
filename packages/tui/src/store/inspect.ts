import {
  PLUGIN_NAME_PATTERN,
  SEMVER_PATTERN,
  SKILL_NAME_PATTERN,
  StoreError,
  type PluginCategory,
} from './contract.js';
import type { StoreArchiveFile } from './archive.js';
import { escapeControl, oneLine } from './text.js';

/**
 * What a verified archive actually contains, read from its bytes. The install consent shown to a
 * person comes from here, never from the index: an index that understates what a package runs
 * cannot talk anyone into it.
 */

export interface ExecutionNote {
  readonly kind: 'mcp-stdio' | 'mcp-remote' | 'hook' | 'app';
  /** One line a person can read and judge, for example `MCP server "search" runs: npx -y x`. */
  readonly line: string;
}

export interface InspectedSkill {
  readonly name: string;
  readonly description: string;
  readonly hasScripts: boolean;
}

export interface PluginInspection {
  readonly kind: 'plugin';
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly author: string;
  readonly category: PluginCategory;
  readonly skills: readonly InspectedSkill[];
  readonly mcpServers: readonly string[];
  readonly apps: readonly string[];
  readonly hooks: number;
  readonly files: number;
  readonly executes: readonly ExecutionNote[];
  /** True when installing runs commands or connects to a service. */
  readonly requiresConsent: boolean;
}

export interface SkillInspection {
  readonly kind: 'skill';
  readonly name: string;
  readonly description: string;
  readonly files: number;
  readonly hasScripts: boolean;
  readonly executes: readonly ExecutionNote[];
  readonly requiresConsent: false;
}

type Json = Record<string, unknown>;

export function inspectPluginFiles(
  files: readonly StoreArchiveFile[],
  expected: { readonly name: string; readonly version: string },
): PluginInspection {
  const byPath = new Map(files.map((file) => [file.path, file.content] as const));
  const manifestBytes = byPath.get('.alran-plugin/plugin.json');
  if (!manifestBytes) bad('has no .alran-plugin/plugin.json');
  const manifest = parseJson(manifestBytes, '.alran-plugin/plugin.json');
  if (manifest.schemaVersion !== 1) bad('manifest schemaVersion must be 1');
  const name = text(manifest.name, 'manifest name');
  if (!PLUGIN_NAME_PATTERN.test(name) || name !== expected.name) {
    bad(`manifest name "${name}" is not the listed name "${expected.name}"`);
  }
  const version = text(manifest.version, 'manifest version');
  if (!SEMVER_PATTERN.test(version) || version !== expected.version) {
    bad(`manifest version "${version}" is not the listed version "${expected.version}"`);
  }
  const icon = text(manifest.icon, 'manifest icon');
  if (!byPath.has(icon)) bad(`icon ${icon} is missing`);

  const skills = list(manifest.skills, 'skills').map((reference) => {
    const skillFile = text(reference, 'skills entry');
    const match = /^skills\/([A-Za-z0-9._-]+)\/SKILL\.md$/u.exec(skillFile);
    if (!match?.[1]) bad(`skill reference ${skillFile} is not skills/<name>/SKILL.md`);
    const content = byPath.get(skillFile);
    if (!content) bad(`${skillFile} is missing`);
    const front = readSkillFrontmatter(content.toString('utf8'), skillFile);
    if (front.name !== match[1]) bad(`${skillFile} names the skill "${front.name}"`);
    return {
      name: front.name,
      description: oneLine(front.description),
      hasScripts: [...byPath.keys()].some((file) => file.startsWith(`skills/${match[1]}/scripts/`)),
    };
  });

  const executes: ExecutionNote[] = [];
  const mcpServers: string[] = [];
  for (const reference of list(manifest.mcpServers, 'mcpServers')) {
    const file = text(reference, 'mcpServers entry');
    const document = parseJson(requireFile(byPath, file), file);
    const servers = record(document.mcpServers, `${file} mcpServers`);
    for (const [serverName, raw] of Object.entries(servers)) {
      const server = record(raw, `${file} server ${serverName}`);
      mcpServers.push(escapeControl(serverName));
      if (server.type === 'stdio') {
        const args = Array.isArray(server.args) ? server.args.map(String) : [];
        executes.push({
          kind: 'mcp-stdio',
          line: escapeControl(
            `MCP server "${serverName}" runs: ${[String(server.command), ...args].join(' ')}`,
          ),
        });
      } else {
        executes.push({
          kind: 'mcp-remote',
          line: escapeControl(`MCP server "${serverName}" connects to: ${String(server.url)}`),
        });
      }
    }
  }

  const apps: string[] = [];
  for (const reference of list(manifest.apps, 'apps')) {
    const file = text(reference, 'apps entry');
    const provider = text(parseJson(requireFile(byPath, file), file).provider, `${file} provider`);
    apps.push(escapeControl(provider));
    executes.push({
      kind: 'app',
      line: escapeControl(`Connector "${provider}" asks to link an account`),
    });
  }

  let hooks = 0;
  for (const reference of list(manifest.hooks, 'hooks')) {
    const file = text(reference, 'hooks entry');
    const document = parseJson(requireFile(byPath, file), file);
    for (const [event, groups] of Object.entries(record(document.hooks, `${file} hooks`))) {
      for (const group of list(groups, `${file} ${event}`)) {
        for (const handler of list(record(group, `${file} ${event} group`).hooks, 'hooks')) {
          const entry = record(handler, `${file} ${event} handler`);
          if (entry.type !== 'command') continue;
          hooks += 1;
          executes.push({
            kind: 'hook',
            line: escapeControl(`Hook on ${event} runs: ${String(entry.command)}`),
          });
        }
      }
    }
  }

  const displayName =
    typeof manifest.displayName === 'string' && manifest.displayName.trim()
      ? manifest.displayName.trim()
      : name;
  return {
    kind: 'plugin',
    name,
    version,
    displayName: oneLine(displayName),
    description: oneLine(text(manifest.description, 'manifest description')),
    author: oneLine(text(manifest.author, 'manifest author')),
    category: text(manifest.category, 'manifest category') as PluginCategory,
    skills,
    mcpServers,
    apps,
    hooks,
    files: files.length,
    executes,
    requiresConsent: executes.length > 0,
  };
}

export function inspectSkillFiles(
  files: readonly StoreArchiveFile[],
  expected: { readonly name: string },
): SkillInspection {
  if (!SKILL_NAME_PATTERN.test(expected.name)) bad(`"${expected.name}" is not a Skill name`);
  const skillFile = files.find((file) => file.path === 'SKILL.md');
  if (!skillFile) bad('has no SKILL.md at its root');
  const front = readSkillFrontmatter(skillFile.content.toString('utf8'), 'SKILL.md');
  if (front.name !== expected.name) {
    bad(`SKILL.md names the skill "${front.name}", the store lists "${expected.name}"`);
  }
  return {
    kind: 'skill',
    name: front.name,
    description: oneLine(front.description),
    files: files.length,
    hasScripts: files.some((file) => file.path.startsWith('scripts/')),
    executes: [],
    requiresConsent: false,
  };
}

/** The `name` and `description` of a SKILL.md; the runtime reads the rest when it loads it. */
export function readSkillFrontmatter(
  content: string,
  file: string,
): { readonly name: string; readonly description: string } {
  if (content.charCodeAt(0) === 0xfeff) bad(`${file} starts with a byte order mark`);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match?.[1]) bad(`${file} has no YAML frontmatter`);
  const fields = parseFrontmatterFields(match[1]);
  const name = fields.get('name');
  const description = fields.get('description');
  if (!name) bad(`${file} frontmatter has no name`);
  if (!description) bad(`${file} frontmatter has no description`);
  return { name, description };
}

/** Top-level `key: value` pairs: plain, quoted, folded (`>`) and literal (`|`) scalars. */
function parseFrontmatterFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = block.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
    if (!match?.[1]) continue;
    const key = match[1];
    let value = (match[2] ?? '').trim();
    if (/^[|>][+-]?$/u.test(value)) {
      const folded = value.startsWith('>');
      const body: string[] = [];
      while (index + 1 < lines.length && /^(\s+|$)/u.test(lines[index + 1] ?? '')) {
        index += 1;
        body.push((lines[index] ?? '').trim());
      }
      value = body.filter((part, position) => part || position < body.length - 1).join(folded ? ' ' : '\n').trim();
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replace(/''/gu, "'");
    } else if (value === '') {
      const body: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/u.test(lines[index + 1] ?? '')) {
        index += 1;
        body.push((lines[index] ?? '').trim());
      }
      value = body.join(' ');
    }
    if (!fields.has(key)) fields.set(key, value);
  }
  return fields;
}

function parseJson(bytes: Buffer, file: string): Json {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    bad(`${file} is not valid JSON`);
  }
  return record(document, file);
}

function requireFile(files: ReadonlyMap<string, Buffer>, file: string): Buffer {
  const bytes = files.get(file);
  if (!bytes) bad(`${file} is listed in the manifest but missing`);
  return bytes;
}

function record(value: unknown, at: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bad(`${at} must be an object`);
  }
  return value as Json;
}

function list(value: unknown, at: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(`${at} must be an array`);
  return value;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim()) bad(`${at} must be a non-empty string`);
  return value.trim();
}

function bad(problem: string): never {
  throw new StoreError('PACKAGE_INVALID', `The package ${problem}.`);
}
