import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseCanonicalAgentMarkdown } from '../../../../agent/storage/canonical-agent-config.js';
import { writePluginTree } from '../../../../../../test/helpers/plugin-package.js';
import { canonicalizePluginRoot } from '../filesystem.js';
import { readAlranPlugin } from '../package-readers.js';
import { readAlranPluginAgents } from './alran.js';

const roots: string[] = [];
const pluginRootToken = ['$', '{PLUGIN_ROOT}'].join('');
const REVIEWER = [
  '---',
  'name: reviewer',
  'description: Reviews a change',
  'model: alran/Alran-M2',
  'effort: high',
  'tools: [read, grep]',
  'mcpServers: [docs]',
  'skills: [research, standalone-notes]',
  'x-mavis:',
  '  displayName: Code Reviewer',
  '  contextWindow: 64000',
  '---',
  '',
  `Review the diff in ${pluginRootToken}.`,
  '',
].join('\n');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Alran Plugin Agents', () => {
  it('reads a declared Agent with the Custom Agent field contract', async () => {
    const root = await pluginRoot('alran-agent');
    await writePluginTree(
      root,
      miniMaxFiles({ agents: ['agents/reviewer.md'] }, { 'agents/reviewer.md': REVIEWER }),
    );

    const plugin = await readAlranPlugin(root, { source: 'LOCAL_ALRAN' });
    const custom = parseCanonicalAgentMarkdown(REVIEWER, 'reviewer');

    expect(plugin.diagnostics).toEqual([]);
    expect(plugin.agents).toEqual([
      {
        name: 'reviewer',
        scopedName: 'demo:reviewer',
        sourceFormat: 'ALRAN',
        description: custom.description,
        displayName: 'Code Reviewer',
        content: REVIEWER,
        systemPrompt: custom.systemPrompt,
        agentFilePath: join(plugin.rootPath, 'agents', 'reviewer.md'),
        model: custom.model,
        effort: custom.effort,
        tools: custom.tools,
        mcpServers: custom.mcpServers,
        skills: ['demo:research', 'standalone-notes'],
        extensionSkills: ['demo:research'],
        contextWindow: 64000,
      },
    ]);
    expect(custom.systemPrompt).toBe(`Review the diff in ${pluginRootToken}.\n`);
  });

  it('keeps the file stem as identity and reports Custom Agent field diagnostics', async () => {
    const root = await pluginRoot('alran-agent-diagnostics');
    await writePluginTree(
      root,
      miniMaxFiles(
        { agents: ['agents/reviewer.md'] },
        {
          'agents/reviewer.md': [
            '---',
            'name: Different',
            'description: Reviews',
            'hooks: {}',
            'x-mavis:',
            '  avatar: avatar.png',
            '---',
            'Body',
          ].join('\n'),
        },
      ),
    );

    const plugin = await readAlranPlugin(root, { source: 'LOCAL_ALRAN' });

    expect(plugin.agents?.map((agent) => agent.scopedName)).toEqual(['demo:reviewer']);
    expect(plugin.diagnostics).toEqual([
      { code: 'agent_name_mismatch', capability: 'AGENT', name: 'agents/reviewer.md#name' },
      { code: 'unsupported_agent_field', capability: 'AGENT', name: 'agents/reviewer.md#hooks' },
      {
        code: 'AGENT_FIELD_IGNORED',
        capability: 'AGENT',
        name: 'agents/reviewer.md#x-mavis.avatar',
      },
    ]);
  });

  it('accepts a package whose only capability is an Agent', async () => {
    const root = await pluginRoot('alran-agent-only');
    await writePluginTree(
      root,
      miniMaxFiles(
        { mcpServers: [], skills: [], agents: ['agents/reviewer.md'] },
        { 'agents/reviewer.md': REVIEWER },
      ),
    );

    const plugin = await readAlranPlugin(root, { source: 'LOCAL_ALRAN' });

    expect(plugin.agents).toHaveLength(1);
    expect(plugin.agents?.[0]).toMatchObject({ skills: ['research', 'standalone-notes'] });
    expect(plugin.agents?.[0]?.extensionSkills).toEqual([]);
  });

  it.each([
    ['inherit model literal', 'description: Reviews\nmodel: inherit'],
    ['comma-separated tools', 'description: Reviews\ntools: read, grep'],
    ['blank description', 'description: " "'],
  ])('rejects the package for an invalid Agent file: %s', async (_label, fields) => {
    const root = await pluginRoot('alran-agent-invalid');
    await writePluginTree(
      root,
      miniMaxFiles(
        { agents: ['agents/reviewer.md'] },
        { 'agents/reviewer.md': `---\nname: reviewer\n${fields}\n---\nBody\n` },
      ),
    );

    await expect(readAlranPlugin(root, { source: 'LOCAL_ALRAN' })).rejects.toMatchObject({
      code: 'AGENT_SCHEMA_INVALID',
    });
  });

  it.each(['agents/Reviewer.md', 'agents/review/security.md', '../reviewer.md', 'reviewer.md'])(
    'rejects the manifest path %s',
    async (agentPath) => {
      const root = await pluginRoot('alran-agent-path');
      await writePluginTree(root, miniMaxFiles({ agents: [agentPath] }));

      await expect(readAlranPlugin(root, { source: 'LOCAL_ALRAN' })).rejects.toMatchObject({
        code: 'MANIFEST_SCHEMA_INVALID',
      });
    },
  );

  it('rejects a declared Agent file that does not exist', async () => {
    const root = await pluginRoot('alran-agent-missing');
    await writePluginTree(root, miniMaxFiles({ agents: ['agents/reviewer.md'] }));

    await expect(readAlranPlugin(root, { source: 'LOCAL_ALRAN' })).rejects.toBeInstanceOf(
      Error,
    );
  });

  it('skips Agents of a Plugin named agent and keeps its other capabilities', async () => {
    const root = await pluginRoot('alran-agent-namespace');
    await writePluginTree(
      root,
      miniMaxFiles(
        { name: 'agent', agents: ['agents/reviewer.md'] },
        { 'agents/reviewer.md': REVIEWER },
      ),
    );

    const plugin = await readAlranPlugin(root, { source: 'LOCAL_ALRAN' });

    expect(plugin.agents).toBeUndefined();
    expect(plugin.skills).toHaveLength(1);
    expect(plugin.diagnostics).toEqual([
      { code: 'AGENT_NAMESPACE_RESERVED', capability: 'AGENT', name: 'agent' },
    ]);
  });

  it('skips an Agent whose scoped name exceeds 64 characters', async () => {
    const root = await pluginRoot('alran-agent-long');
    const name = `a${'b'.repeat(60)}`;
    await writePluginTree(
      root,
      miniMaxFiles(
        { agents: [`agents/${name}.md`] },
        { [`agents/${name}.md`]: `---\nname: ${name}\ndescription: Long\n---\nBody\n` },
      ),
    );
    const canonical = await canonicalizePluginRoot(root);

    const result = await readAlranPluginAgents(canonical, {
      pluginName: 'demo-plugin',
      declared: [`agents/${name}.md`],
      skills: [],
    });

    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: 'AGENT_SCOPED_NAME_TOO_LONG',
        capability: 'AGENT',
        name: `agents/${name}.md`,
      },
    ]);
  });
});

async function pluginRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  roots.push(root);
  return root;
}

function miniMaxFiles(
  overrides: Record<string, unknown> = {},
  extraFiles: Record<string, string> = {},
): Record<string, string | Buffer> {
  return {
    '.alran-plugin/plugin.json': JSON.stringify({
      schemaVersion: 1,
      name: 'demo',
      version: '1.0.0',
      description: 'Demo',
      author: 'Alran',
      icon: 'icon.png',
      category: 'Other',
      exampleQueries: [],
      apps: [],
      mcpServers: [],
      skills: ['skills/research/SKILL.md'],
      ...overrides,
    }),
    'icon.png': Buffer.from([0]),
    'skills/research/SKILL.md': '---\nname: research\ndescription: Research a topic\n---\nGo.\n',
    ...extraFiles,
  };
}
