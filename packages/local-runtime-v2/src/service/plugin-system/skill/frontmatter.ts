import { parseDocument } from 'yaml';

import { readerFail } from '../plugin/package/reader-errors.js';

export function parseSkillFrontmatter(
  content: string,
  relativeSkillFile: string,
): Record<string, unknown> {
  const opening = /^---\r?\n/u.exec(content);
  if (!opening) {
    readerFail('SKILL_SCHEMA_INVALID', `${relativeSkillFile} must start with YAML frontmatter`);
  }
  const remainder = content.slice(opening[0].length);
  const closing = /(?:^|\r?\n)---(?:\r?\n|$)/u.exec(remainder);
  if (!closing || closing.index === undefined) {
    readerFail('SKILL_SCHEMA_INVALID', `${relativeSkillFile} has unclosed YAML frontmatter`);
  }
  const yamlText = remainder.slice(0, closing.index + delimiterPrefixLength(closing[0]));
  const value = parseFrontmatterYaml(yamlText);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    readerFail('SKILL_SCHEMA_INVALID', `${relativeSkillFile} frontmatter must be a mapping`);
  }
  return textFields(value as Record<string, unknown>, yamlText);
}

/**
 * The two fields a Skill has to have as text, read as text.
 *
 * YAML reads a description that was written as a list as a list, and a frontmatter it cannot read
 * at all is read field by field. The Store reads a Skill that way, and the rules a Skill has to
 * meet are about its fields and not about the parser that read them.
 */
function textFields(value: Record<string, unknown>, yamlText: string): Record<string, unknown> {
  const keys = ['name', 'description'] as const;
  if (keys.every((key) => typeof value[key] === 'string')) return value;
  const fields = parseFrontmatterFields(yamlText);
  const result = { ...value };
  for (const key of keys) {
    if (typeof result[key] !== 'string' && typeof fields[key] === 'string') result[key] = fields[key];
  }
  return result;
}

function delimiterPrefixLength(delimiter: string): number {
  if (delimiter.startsWith('\r\n')) return 2;
  if (delimiter.startsWith('\n')) return 1;
  return 0;
}

function parseFrontmatterYaml(yamlText: string): unknown {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(yamlText, { uniqueKeys: true });
  } catch {
    // Frontmatter that YAML cannot read is read field by field below.
    return parseFrontmatterFields(yamlText);
  }
  if (document.errors.length > 0) {
    return parseFrontmatterFields(yamlText);
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 20 });
  } catch {
    return parseFrontmatterFields(yamlText);
  }
  return value;
}

/**
 * The fields of a frontmatter that YAML cannot read, read one line at a time.
 *
 * A Skill is written by whoever wrote it, and a plain value that holds a colon and a space — a
 * description that says "Trigger words: foo" — is not YAML, and a parser that insists on YAML
 * refuses the Skill. The Store reads such a Skill, and the rules a Skill has to meet are about its
 * fields and not about the parser that read them, so the fields are read here as well.
 */
function parseFrontmatterFields(yamlText: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = yamlText.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
    if (!match?.[1]) continue;
    const key = match[1];
    let value = (match[2] ?? '').trim();
    if (/^[|>][+-]?$/u.test(value)) {
      const folded = value.startsWith('>');
      const body: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/u.test(lines[index + 1] ?? '')) {
        index += 1;
        body.push((lines[index] ?? '').trim());
      }
      value = body
        .filter((part, position) => part || position < body.length - 1)
        .join(folded ? ' ' : '\n')
        .trim();
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
    if (fields[key] === undefined) fields[key] = value;
  }
  return fields;
}
