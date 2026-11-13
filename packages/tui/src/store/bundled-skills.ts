import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { readSkillFrontmatter } from './inspect.js';
import { oneLine } from './text.js';

/** A Skill that ships inside Alran Code itself. */
export interface BundledSkill {
  readonly name: string;
  readonly description: string;
}

/**
 * Where the Skills that ship with Alran Code are on disk, found from the URL of the module that
 * asks: next to a built CLI (`dist/chunks/*.js` or `dist/*.js` beside `dist/assets/skills`), or in
 * the source tree (`packages/local-runtime/assets/skills`). `undefined` when neither exists.
 */
export function locateBundledSkillsDirectory(moduleUrl: string): string | undefined {
  const candidates = [
    '../assets/skills/',
    './assets/skills/',
    '../../../local-runtime/assets/skills/',
  ];
  for (const candidate of candidates) {
    const directory = fileURLToPath(new URL(candidate, moduleUrl));
    if (existsSync(directory)) return directory;
  }
  return undefined;
}

/** Reads `<directory>/<name>/SKILL.md` for every Skill folder; a folder that cannot be read is skipped. */
export async function readBundledSkills(directory: string): Promise<BundledSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const skills: BundledSkill[] = [];
  for (const name of entries.sort()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const text = await readFile(path.join(directory, name, 'SKILL.md'), 'utf8');
      const front = readSkillFrontmatter(text, `${name}/SKILL.md`);
      skills.push({ name: front.name, description: oneLine(front.description) });
    } catch {
      // Not a Skill folder (or not readable): it is simply not listed.
    }
  }
  return skills;
}
