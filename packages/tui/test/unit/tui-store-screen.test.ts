import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import type { StoreCatalog, StoreItem } from '../../src/store/application.js';
import type { StoreSourceStatus } from '../../src/store/contract.js';
import { TuiStoreScreen, type StoreTab } from '../../src/tui/features/store/store-screen.js';
import { visibleWidth } from '../../src/tui/rendering/text.js';

const ENTER = '\r';
const ESCAPE = '\u001b';
const TAB = '\t';
const SPACE = ' ';
const DELETE = '\u001b[3~';
const CTRL_R = '\u0012';
const DOWN = '\u001b[B';

function item(overrides: Partial<StoreItem> & { name: string; kind: StoreItem['kind'] }): StoreItem {
  return {
    id: `${overrides.kind}:${overrides.name}@${overrides.origin ?? 'ottili'}`,
    displayName: overrides.name,
    description: `Description of ${overrides.name}.`,
    origin: 'ottili',
    version: '1.0.0',
    installed: false,
    enabled: false,
    updateAvailable: false,
    summary: '1 skill',
    entry: (overrides.kind === 'plugin'
      ? { kind: 'plugin', exampleQueries: [], contents: { skills: [], mcpServers: [], apps: [], hooks: 0 } }
      : { kind: 'skill' }) as never,
    ...overrides,
  };
}

const source = (id: string, extra: Partial<StoreSourceStatus> = {}): StoreSourceStatus => ({
  source: { id, url: `https://${id}.example/index.json`, label: `${id} store` },
  index: { schema: 'alran.store/v1', name: id, plugins: [], skills: [] },
  stale: false,
  ...extra,
});

const items = [
  item({ kind: 'plugin', name: 'playbooks', displayName: 'Engineering Playbooks', group: 'Code', summary: '10 skills', description: 'Ten playbooks for reliable software.' }),
  item({ kind: 'plugin', name: 'runner', displayName: 'Search Runner', group: 'Code', summary: '1 skill · 1 MCP' }),
  item({ kind: 'plugin', name: 'installed-plugin', displayName: 'Installed One', installed: true, enabled: true, installedVersion: '1.0.0' }),
  item({ kind: 'plugin', name: 'off-plugin', displayName: 'Switched Off', installed: true, enabled: false, installedVersion: '1.0.0' }),
  item({ kind: 'plugin', name: 'folder-plugin', displayName: 'Folder Plugin', origin: 'local', installed: true, enabled: true, entry: undefined }),
  item({ kind: 'skill', name: 'pg-rls', displayName: 'Postgres RLS', group: 'Engineering', description: 'Row level security for tenants.', summary: '3 files' }),
  item({ kind: 'skill', name: 'honest-status', displayName: 'Honest Status', group: 'Engineering', installed: true, enabled: true, installedVersion: '1.0.0', updateAvailable: true, version: '1.1.0' }),
  item({ kind: 'skill', name: 'taken', displayName: 'Taken Name', group: 'Engineering', conflict: 'local' }),
];

const staged = (overrides: Record<string, unknown> = {}) =>
  ({
    entry: { name: 'x', version: '1.0.0', kind: 'plugin' },
    inspection: { requiresConsent: false, executes: [] },
    ...overrides,
  }) as never;

function createScreen(options: { catalog?: Partial<StoreCatalog>; tab?: StoreTab; query?: string } = {}) {
  const catalog: StoreCatalog = { items, sources: [source('ottili')], ...options.catalog };
  const actions = {
    stage: vi.fn(async () => staged()),
    commit: vi.fn(async () => ({ warnings: [] as string[] })),
    installOfficial: vi.fn(async () => undefined),
    remove: vi.fn(async () => [] as string[]),
    setEnabled: vi.fn(async () => undefined),
    reload: vi.fn(async () => catalog),
  };
  const onCancel = vi.fn();
  const screen = new TuiStoreScreen({
    catalog,
    actions,
    ...(options.tab ? { initialTab: options.tab } : {}),
    ...(options.query ? { initialQuery: options.query } : {}),
    onCancel,
    requestRender: vi.fn(),
  });
  const text = (width = 100) => stripVTControlCharacters(screen.render(width).join('\n'));
  return { screen, actions, onCancel, text, catalog };
}

describe('TuiStoreScreen', () => {
  it('renders Plugins with tabs, counts and bounded lines, and leaves out folder Plugins', () => {
    const { screen, text } = createScreen();
    const lines = screen.render(78);
    expect(lines.every((line) => visibleWidth(line) <= 78)).toBe(true);
    const rendered = text(78);
    expect(rendered).toContain('Alran Store');
    expect(rendered).toContain('4 Plugins · 3 Skills in stores · 4 installed');
    expect(rendered).toContain('[Plugins]');
    expect(rendered).toContain('Skill Library');
    expect(rendered).toContain('Installed (4)');
    expect(rendered).toContain('Stores (1)');
    expect(rendered).toContain('Engineering Playbooks');
    expect(rendered).not.toContain('Folder Plugin');
  });

  it('shows the Skill Library on its own tab, with state per row', () => {
    const { screen, text } = createScreen({ tab: 'skills' });
    const rendered = text(110);
    expect(rendered).toContain('[Skill Library]');
    expect(rendered).toContain('Postgres RLS');
    expect(rendered).toMatch(/\[ \] Postgres RLS\s+v1\.0\.0 · Engineering · 3 files/u);
    expect(rendered).toMatch(/Honest Status\s+v1\.1\.0 · Engineering · 1 skill · update ↑/u);
    expect(rendered).toMatch(/\[!\] Taken Name.*local copy/u);
    expect(rendered).not.toContain('Engineering Playbooks');
    void screen;
  });

  it('lists everything installed, folders included, on the Installed tab', () => {
    const { text } = createScreen({ tab: 'installed' });
    const rendered = text(110);
    expect(rendered).toContain('Installed One');
    expect(rendered).toContain('Folder Plugin');
    expect(rendered).toContain('Honest Status');
    expect(rendered).toMatch(/Switched Off.*disabled/u);
    expect(rendered).not.toContain('Search Runner');
  });

  it('cycles tabs with Tab and Shift+Tab', () => {
    const { screen, text } = createScreen();
    screen.handleInput(TAB);
    expect(text()).toContain('[Skill Library]');
    screen.handleInput(TAB);
    expect(text()).toMatch(/\[Installed \(4\)\]/u);
    screen.handleInput(TAB);
    expect(text()).toContain('[Stores (1)]');
    screen.handleInput('\u001b[Z');
    expect(text()).toMatch(/\[Installed \(4\)\]/u);
  });

  it('filters by typing, ranks the best match first, and clears with Escape before closing', () => {
    const { screen, text, onCancel } = createScreen();
    for (const key of 'play') screen.handleInput(key);
    let rendered = text();
    expect(rendered).toContain('Engineering Playbooks');
    expect(rendered).not.toContain('Search Runner');
    for (const key of 'zzz') screen.handleInput(key);
    expect(text()).toContain('Nothing matches your search.');
    screen.handleInput(ESCAPE);
    expect(onCancel).not.toHaveBeenCalled();
    rendered = text();
    expect(rendered).toContain('Search Runner');
    screen.handleInput(ESCAPE);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('opens with an initial query and tab', () => {
    const { text } = createScreen({ tab: 'skills', query: 'row level' });
    const rendered = text();
    expect(rendered).toContain('Postgres RLS');
    expect(rendered).not.toContain('Honest Status');
  });

  it('shows what the selected item is, and what Enter will do', () => {
    const { screen, text } = createScreen({
      catalog: {
        items: [
          item({
            kind: 'plugin',
            name: 'playbooks',
            displayName: 'Engineering Playbooks',
            author: 'Ottili',
            license: 'MIT',
            group: 'Code',
            entry: {
              kind: 'plugin',
              homepage: 'https://x.example',
              exampleQueries: ['Review this migration for tables that lack row-level security'],
              contents: { skills: [{ name: 'pg-rls' }, { name: 'honest-status' }], mcpServers: [], apps: [], hooks: 0 },
            } as never,
          }),
        ],
        sources: [source('ottili')],
      },
    });
    const rendered = text(100);
    expect(rendered).toContain('v1.0.0 · by Ottili · Code · MIT');
    expect(rendered).toContain('Skills: pg-rls, honest-status');
    expect(rendered).toContain('Try: “Review this migration');
    expect(rendered).toContain('Not installed · Enter installs it');
    void screen;
  });

  describe('installing', () => {
    it('installs a package that runs nothing at once, then reloads the list', async () => {
      const { screen, actions, text } = createScreen();
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(actions.commit).toHaveBeenCalled());
      expect(actions.stage).toHaveBeenCalledWith(expect.objectContaining({ name: 'playbooks' }));
      expect(actions.commit).toHaveBeenCalledWith(expect.anything(), false);
      await vi.waitFor(() => expect(text()).toContain('Installed Engineering Playbooks 1.0.0 — enabled.'));
      expect(actions.reload).toHaveBeenCalledWith({ refresh: false });
    });

    it('stops at the list of commands a package runs and waits for approval', async () => {
      const { screen, actions, text } = createScreen();
      actions.stage.mockResolvedValue(
        staged({
          entry: { name: 'runner', version: '2.0.0', kind: 'plugin' },
          inspection: {
            requiresConsent: true,
            executes: [
              { kind: 'mcp-stdio', line: 'MCP server "search" runs: npx -y search-mcp' },
              { kind: 'hook', line: 'Hook on Stop runs: bash "$PLUGIN_ROOT/done.sh"' },
            ],
          },
        }),
      );
      screen.handleInput(DOWN);
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(text()).toContain('will run commands or connect to services'));
      const rendered = text();
      expect(rendered).toContain('• MCP server "search" runs: npx -y search-mcp');
      expect(rendered).toContain('• Hook on Stop runs: bash "$PLUGIN_ROOT/done.sh"');
      expect(rendered).toContain('Enter approve and install · Esc cancel');
      expect(actions.commit).not.toHaveBeenCalled();
      // Anything but Enter or Escape is ignored while the question is open.
      screen.handleInput('x');
      screen.handleInput(TAB);
      expect(actions.commit).not.toHaveBeenCalled();
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(actions.commit).toHaveBeenCalledWith(expect.anything(), true));
      await vi.waitFor(() => expect(text()).toContain('Installed Search Runner 2.0.0'));
    });

    it('installs nothing when approval is refused', async () => {
      const { screen, actions, text, onCancel } = createScreen();
      actions.stage.mockResolvedValue(staged({ inspection: { requiresConsent: true, executes: [{ kind: 'hook', line: 'Hook on Stop runs: x' }] } }));
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(text()).toContain('Enter approve and install'));
      screen.handleInput(ESCAPE);
      expect(text()).toContain('Not installed.');
      expect(actions.commit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('updates an installed Skill that has a newer version', async () => {
      const { screen, actions, text } = createScreen({ tab: 'skills' });
      actions.stage.mockResolvedValue(staged({ entry: { name: 'honest-status', version: '1.1.0', kind: 'skill' }, replacesVersion: '1.0.0' }));
      screen.handleInput(DOWN);
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(text()).toContain('Updated Honest Status 1.1.0.'));
    });

    it('leaves a name that is taken by something else alone', () => {
      const { screen, actions, text } = createScreen({ tab: 'skills' });
      screen.handleInput(DOWN);
      screen.handleInput(DOWN);
      screen.handleInput(ENTER);
      expect(actions.stage).not.toHaveBeenCalled();
      expect(text()).toContain('already installed outside the Store; it is left alone.');
    });

    it('says an up-to-date package is installed instead of fetching it again', () => {
      const { screen, actions, text } = createScreen({ tab: 'installed' });
      screen.handleInput(ENTER);
      expect(actions.stage).not.toHaveBeenCalled();
      expect(text()).toContain('is installed (1.0.0).');
    });

    it('reports a failed install with a next step and stays usable', async () => {
      const { screen, actions, text } = createScreen();
      actions.stage.mockRejectedValue(new Error('the archive does not match the SHA-256 in the index'));
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(text()).toContain("Couldn't install Engineering Playbooks"));
      expect(text()).toContain('does not match the SHA-256');
      expect(text()).toContain('or run alran plugin install for details.');
      screen.handleInput(DOWN);
      expect(text()).toContain('Search Runner');
    });

    it('installs a Plugin of the Runtime registry through the registry path', async () => {
      const official = item({ kind: 'plugin', name: 'office', displayName: 'Office', origin: 'official', entry: undefined });
      const { screen, actions, text } = createScreen({ catalog: { items: [official], sources: [] } });
      screen.handleInput(ENTER);
      await vi.waitFor(() => expect(actions.installOfficial).toHaveBeenCalledWith(official));
      await vi.waitFor(() => expect(text()).toContain('Office installed.'));
    });
  });

  describe('managing what is installed', () => {
    it('switches a Plugin on and off with Space, and ignores Space on a Skill', async () => {
      const { screen, actions, text } = createScreen({ tab: 'installed' });
      screen.handleInput(SPACE);
      await vi.waitFor(() => expect(actions.setEnabled).toHaveBeenCalledWith(expect.objectContaining({ name: 'installed-plugin' }), false));
      await vi.waitFor(() => expect(text()).toContain('Installed One: disabled.'));
      screen.handleInput(DOWN);
      screen.handleInput(DOWN);
      screen.handleInput(DOWN);
      screen.handleInput(DOWN);
      screen.handleInput(SPACE);
      expect(actions.setEnabled).toHaveBeenCalledTimes(1);
    });

    it('removes with Delete only while the search box is empty', async () => {
      const { screen, actions, text } = createScreen({ tab: 'installed' });
      screen.handleInput(DELETE);
      await vi.waitFor(() => expect(actions.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'installed-plugin' })));
      await vi.waitFor(() => expect(text()).toContain('Removed Installed One.'));
      screen.handleInput('o');
      actions.remove.mockClear();
      screen.handleInput(DELETE);
      expect(actions.remove).not.toHaveBeenCalled();
    });

    it('refreshes the stores with Ctrl+R and reports one that cannot be read', async () => {
      const { screen, actions, text } = createScreen();
      actions.reload.mockResolvedValue({ items, sources: [source('ottili'), source('acme', { index: undefined, error: 'offline' })] });
      screen.handleInput(CTRL_R);
      await vi.waitFor(() => expect(actions.reload).toHaveBeenCalledWith({ refresh: true }));
      await vi.waitFor(() => expect(text()).toContain('Refreshed; 1 store could not be read (see Stores).'));
    });
  });

  describe('stores tab', () => {
    it('lists every store with its state and the reason one is unreadable', () => {
      const { screen, text } = createScreen({
        tab: 'sources',
        catalog: {
          items,
          sources: [
            source('ottili'),
            source('acme', { stale: true, error: 'ECONNREFUSED' }),
            source('broken', { index: undefined, error: 'Could not read /nowhere' }),
          ],
        },
      });
      let rendered = text(110);
      expect(rendered).toMatch(/\[\*\] ottili store\s+0 Plugins · 0 Skills/u);
      expect(rendered).toMatch(/\[\*\] acme store.*cached copy/u);
      expect(rendered).toMatch(/\[!\] broken store\s+not readable/u);
      screen.handleInput(DOWN);
      screen.handleInput(DOWN);
      rendered = text(110);
      expect(rendered).toContain('Could not be read: Could not read /nowhere');
      expect(rendered).toContain('alran plugin marketplace add <url>');
    });
  });

  it('marks clipped detail text with an ellipsis and keeps Stores hints to what works there', () => {
    const long = item({
      kind: 'plugin',
      name: 'wordy',
      displayName: 'Wordy',
      description: 'word '.repeat(120).trim(),
    });
    const { text } = createScreen({ catalog: { items: [long], sources: [source('ottili')] } });
    expect(text(60)).toMatch(/…\n─|…\nNot installed/u);
    const stores = createScreen({ tab: 'sources' });
    const rendered = stores.text();
    expect(rendered).toContain('Ctrl+R ask the stores again');
    expect(rendered).not.toContain('Space on/off');
  });

  it('shows built-in Skills in the Library only, and refuses to install or remove them', () => {
    const builtin = item({
      kind: 'skill',
      name: 'pdf',
      displayName: 'pdf',
      description: 'Read, create and edit PDF files.',
      origin: 'built-in',
      group: 'Built in',
      installed: true,
      enabled: true,
      version: undefined,
      summary: '',
      entry: undefined,
    });
    const { screen, actions, text } = createScreen({ tab: 'skills', catalog: { items: [builtin], sources: [] } });
    let rendered = text(100);
    expect(rendered).toMatch(/\[\*\] pdf\s+Built in · built in/u);
    expect(rendered).toContain('Built in to Alran Code · always available');
    // Not "installed by someone": not in the count and not on the Installed tab.
    expect(rendered).toContain('0 installed');
    screen.handleInput(ENTER);
    expect(text(100)).toContain('pdf is built in to Alran Code; there is nothing to install.');
    screen.handleInput(DELETE);
    expect(text(100)).toContain('pdf is built in to Alran Code and cannot be removed.');
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.remove).not.toHaveBeenCalled();
    screen.handleInput(TAB);
    rendered = text(100);
    expect(rendered).toContain('[Installed (0)]');
    expect(rendered).toContain('Nothing installed yet.');
  });

  it('says a store Skill with the name of a built-in one is not installed over it', () => {
    const clash = item({ kind: 'skill', name: 'pdf', displayName: 'PDF (store)', conflict: 'built-in', group: 'Docs' });
    const { screen, actions, text } = createScreen({ tab: 'skills', catalog: { items: [clash], sources: [] } });
    expect(text(100)).toMatch(/\[!\] PDF \(store\).*name taken/u);
    expect(text(100)).toContain('A Skill with this name is built in to Alran Code; the Store does not replace it.');
    screen.handleInput(ENTER);
    expect(text(100)).toContain('a Skill with this name is built in to Alran Code; the Store does not replace it.');
    expect(actions.stage).not.toHaveBeenCalled();
  });

  it('says how to add a store when none is configured', () => {
    for (const tab of ['plugins', 'skills'] as const) {
      const { text } = createScreen({ tab, catalog: { items: [], sources: [] } });
      expect(text(100)).toContain('No store is configured yet. Add one from a shell: alran plugin marketplace add <url>');
    }
    const stores = createScreen({ tab: 'sources', catalog: { items: [], sources: [] } });
    expect(stores.text(100)).toContain('No store is configured yet.');
    expect(stores.text(100)).toContain('Add one with: alran plugin marketplace add <url>');
  });

  it('never prints terminal control sequences from an item it was given', () => {
    const hostile = item({
      kind: 'plugin',
      name: 'x',
      displayName: 'Safe\u001b]0;pwned\u0007Name',
      description: 'Line\u001b[2Jcleared',
      author: 'a‮b',
      origin: 'official',
      entry: undefined,
    });
    const { screen } = createScreen({ catalog: { items: [hostile], sources: [] } });
    const raw = screen.render(100).join('\n');
    expect(raw).not.toContain('\u0007');
    expect(raw).not.toContain('\u001b]0;');
    expect(raw).not.toContain('\u001b[2J');
    expect(raw).not.toContain('‮');
  });
});
