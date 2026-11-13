import { formatTuiActionFailure } from '../../../user-facing-failure.js';
import { isBuiltIn, type StoreCatalog, type StoreItem } from '../../../store/application.js';
import type { StoreSourceStatus } from '../../../store/contract.js';
import { itemMarker, searchItems } from '../../../store/format.js';
import type { StagedInstall } from '../../../store/installer.js';
import { Input, matchesKey, VStack } from '../../engine/public.js';
import type { Component, Focusable } from '../../rendering/component.js';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../../rendering/text.js';
import { sanitizeTerminalText } from '../../rendering/terminal-text.js';
import { escapeControl } from '../../../store/text.js';
import type { TuiFeatureScreen } from '../../shell/surface-host.js';
import {
  renderTuiActionHint,
  tuiChalk as chalk,
  tuiColors as colors,
} from '../../theme/runtime.js';
import { TuiSelectionScrollView } from '../../widgets/selection-scroll-view.js';

/** Terminal-safe text: escape sequences stripped, bidi and other control characters made visible. */
const clean = (text: string): string => escapeControl(sanitizeTerminalText(text));

export type StoreTab = 'plugins' | 'skills' | 'installed' | 'sources';
const TABS: readonly StoreTab[] = ['plugins', 'skills', 'installed', 'sources'];
const MAX_DETAIL_LINES = 11;

/** What the screen asks of the Store; the feature flow binds these to the real application. */
export interface TuiStoreActions {
  stage(item: StoreItem): Promise<StagedInstall>;
  commit(staged: StagedInstall, consent: boolean): Promise<{ readonly warnings: readonly string[] }>;
  installOfficial(item: StoreItem): Promise<void>;
  remove(item: StoreItem): Promise<readonly string[]>;
  setEnabled(item: StoreItem, enabled: boolean): Promise<void>;
  reload(options: { readonly refresh: boolean }): Promise<StoreCatalog>;
}

export interface TuiStoreScreenOptions {
  readonly catalog: StoreCatalog;
  readonly actions: TuiStoreActions;
  readonly initialTab?: StoreTab;
  readonly initialQuery?: string;
  readonly onCancel: () => void;
  readonly requestRender: () => void;
}

interface PendingApproval {
  readonly item: StoreItem;
  readonly staged: StagedInstall;
}

export class TuiStoreScreen implements TuiFeatureScreen, Component, Focusable {
  readonly id = 'plugins';
  readonly layoutRoot: Component;
  focused = false;
  private catalog: StoreCatalog;
  private tab: StoreTab;
  private readonly searchInput = new Input({ prompt: '' });
  private readonly bodyViewport: TuiSelectionScrollView;
  private selectedIndex = 0;
  private busy = false;
  private status = '';
  private pending: PendingApproval | undefined;
  private disposed = false;

  constructor(private readonly options: TuiStoreScreenOptions) {
    this.catalog = options.catalog;
    this.tab = options.initialTab ?? 'plugins';
    this.searchInput.setValue(options.initialQuery?.trim() ?? '');
    this.searchInput.moveCursorToEnd();
    const part = (render: (width: number) => string[]): Component => ({
      render,
      invalidate: () => undefined,
    });
    this.bodyViewport = new TuiSelectionScrollView(part((width) => this.renderBody(width)), {
      primary: true,
      overscroll: 'contain',
    });
    this.bodyViewport.setActiveRow(0, true);
    this.layoutRoot = new VStack([
      { component: part((width) => this.renderHeader(width)), basis: 'auto', shrink: 1, minSize: 1 },
      { component: this.bodyViewport, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: part((width) => this.renderDetail(width)), basis: 'auto', shrink: 0, minSize: 0 },
      { component: part((width) => this.renderFooter(width)), basis: 'auto', shrink: 1, minSize: 1 },
    ]);
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      if (this.pending) {
        this.pending = undefined;
        this.status = 'Not installed.';
        this.requestRender();
      } else if (!this.busy && this.searchInput.getValue()) {
        this.searchInput.setValue('');
        this.resetSelection();
        this.requestRender();
      } else this.options.onCancel();
      return;
    }
    if (this.busy) return;
    if (this.pending) {
      if (matchesKey(data, 'enter')) void this.approvePending();
      return;
    }
    if (matchesKey(data, 'tab')) return this.cycleTab(1);
    if (matchesKey(data, 'shift+tab')) return this.cycleTab(-1);
    if (matchesKey(data, 'up')) return this.move(-1);
    if (matchesKey(data, 'down')) return this.move(1);
    if (matchesKey(data, 'enter')) {
      const item = this.selected();
      if (item) void this.install(item);
      return;
    }
    if (matchesKey(data, 'space')) {
      const item = this.selected();
      if (item?.kind === 'plugin' && item.installed && !item.conflict) {
        void this.toggle(item);
      }
      return;
    }
    if (
      this.searchInput.getValue().length === 0 &&
      (matchesKey(data, 'delete') || matchesKey(data, 'ctrl+d'))
    ) {
      const item = this.selected();
      if (item && isBuiltIn(item)) {
        this.status = `${item.displayName} is built in to Alran Code and cannot be removed.`;
        this.requestRender();
      } else if (item?.installed) void this.remove(item);
      return;
    }
    if (matchesKey(data, 'ctrl+r')) {
      void this.reload(true);
      return;
    }
    const previousQuery = this.searchInput.getValue();
    this.searchInput.handleInput(matchesKey(data, 'shift+space') ? ' ' : data);
    if (this.searchInput.getValue() === previousQuery) return;
    this.resetSelection();
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
  }

  invalidate(): void {
    this.layoutRoot.invalidate();
  }

  render(width: number): string[] {
    return [
      ...this.renderHeader(width),
      ...this.renderBody(width),
      ...this.renderDetail(width),
      ...this.renderFooter(width),
    ];
  }

  // ---------------------------------------------------------------- rendering

  private renderHeader(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (!safeWidth) return [];
    this.searchInput.focused = this.focused;
    const searchPrompt = chalk.hex(colors.muted)('Search: ');
    const searchLine = `${searchPrompt}${this.searchInput.render(Math.max(0, safeWidth - visibleWidth(searchPrompt)))[0] ?? ''}`;
    const plugins = this.items('plugins').length;
    const skills = this.items('skills').length;
    const installed = this.items('installed').length;
    return [
      chalk.bold.hex(colors.signal)('Alran Store'),
      chalk.hex(colors.muted)(
        `${plugins} Plugins · ${skills} Skills in stores · ${installed} installed`,
      ),
      this.renderTabs(installed),
      searchLine,
      chalk.hex(colors.line)('─'.repeat(safeWidth)),
    ].map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  private renderTabs(installed: number): string {
    const labels: Record<StoreTab, string> = {
      plugins: 'Plugins',
      skills: 'Skill Library',
      installed: `Installed (${installed})`,
      sources: `Stores (${this.catalog.sources.length})`,
    };
    return TABS.map((id) =>
      id === this.tab
        ? chalk.bold.hex(colors.signal)(`[${labels[id]}]`)
        : chalk.hex(colors.muted)(labels[id]),
    ).join('  ');
  }

  private renderBody(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (!safeWidth) return [];
    const rows = this.rows();
    this.selectedIndex = rows.length ? Math.min(this.selectedIndex, rows.length - 1) : 0;
    this.bodyViewport.setActiveRow(this.selectedIndex);
    if (rows.length === 0) return [chalk.hex(colors.muted)(this.emptyMessage())];
    return rows.map((row, index) =>
      truncateToWidth(
        this.tab === 'sources'
          ? renderSourceRow(row as StoreSourceStatus, index === this.selectedIndex, safeWidth)
          : renderItemRow(row as StoreItem, index === this.selectedIndex, safeWidth, this.tab === 'installed'),
        safeWidth,
        '…',
      ),
    );
  }

  private emptyMessage(): string {
    if (this.catalog.sources.length === 0 && (this.tab === 'plugins' || this.tab === 'skills')) {
      return 'No store is configured yet. Add one from a shell: alran plugin marketplace add <url>';
    }
    if (this.searchInput.getValue().trim()) return 'Nothing matches your search.';
    if (this.tab === 'installed') return 'Nothing installed yet. Pick something from Plugins or the Skill Library.';
    if (this.tab === 'sources') return 'No store is configured yet.';
    const failed = this.catalog.sources.find((status) => !status.index);
    return failed
      ? `The store could not be read: ${clean(failed.error ?? 'unknown error')}`
      : 'The store has nothing here.';
  }

  private renderDetail(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (!safeWidth) return [];
    const lines = this.pending
      ? approvalLines(this.pending, safeWidth)
      : this.tab === 'sources'
        ? sourceDetail(this.selectedSource(), safeWidth)
        : itemDetail(this.selected(), safeWidth);
    return [
      chalk.hex(colors.line)('─'.repeat(safeWidth)),
      ...lines.slice(0, MAX_DETAIL_LINES).map((line) => truncateToWidth(line, safeWidth, '…')),
    ];
  }

  private renderFooter(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (!safeWidth) return [];
    const hints = [
      renderTuiActionHint('↑↓ select · Tab view · type to search · Esc clear/close'),
    ].map((line) => truncateToWidth(line, safeWidth, '…'));
    if (this.pending) {
      return [truncateToWidth(renderTuiActionHint('Enter approve and install · Esc cancel'), safeWidth, '…'), ...hints];
    }
    if (this.status) {
      // A failure carries a reason and a next step: show all of it, not its first 100 columns.
      return [
        ...wrap(this.status, safeWidth)
          .slice(0, 3)
          .map((line) => chalk.hex(colors.accent)(line)),
        ...hints,
      ];
    }
    const actions =
      this.tab === 'sources'
        ? 'Ctrl+R ask the stores again'
        : 'Enter install/update · Space on/off · Delete remove · Ctrl+R refresh';
    return [truncateToWidth(renderTuiActionHint(actions), safeWidth, '…'), ...hints];
  }

  // ------------------------------------------------------------------- state

  private items(tab: StoreTab): StoreItem[] {
    const all = this.catalog.items;
    if (tab === 'plugins') {
      return all.filter((item) => item.kind === 'plugin' && (item.entry !== undefined || item.origin === 'official'));
    }
    if (tab === 'skills') return all.filter((item) => item.kind === 'skill');
    // Built-in Skills ship with Alran Code; they are in the Library, not among what someone installed.
    if (tab === 'installed') return all.filter((item) => item.installed && !isBuiltIn(item));
    return [];
  }

  private rows(): readonly (StoreItem | StoreSourceStatus)[] {
    if (this.tab === 'sources') return this.catalog.sources;
    return searchItems(this.items(this.tab), this.searchInput.getValue());
  }

  private selected(): StoreItem | undefined {
    if (this.tab === 'sources') return undefined;
    return this.rows()[this.selectedIndex] as StoreItem | undefined;
  }

  private selectedSource(): StoreSourceStatus | undefined {
    return this.tab === 'sources' ? (this.rows()[this.selectedIndex] as StoreSourceStatus | undefined) : undefined;
  }

  private move(delta: number): void {
    const count = this.rows().length;
    this.selectedIndex = count ? Math.max(0, Math.min(count - 1, this.selectedIndex + delta)) : 0;
    this.bodyViewport.setActiveRow(this.selectedIndex, true);
    this.status = '';
    this.requestRender();
  }

  private cycleTab(delta: number): void {
    this.tab = TABS[(TABS.indexOf(this.tab) + delta + TABS.length) % TABS.length] ?? 'plugins';
    this.resetSelection();
    this.requestRender();
  }

  private resetSelection(): void {
    this.selectedIndex = 0;
    this.bodyViewport.setActiveRow(0, true);
    this.status = '';
  }

  // ----------------------------------------------------------------- actions

  private async install(item: StoreItem): Promise<void> {
    if (isBuiltIn(item)) {
      this.status = `${item.displayName} is built in to Alran Code; there is nothing to install.`;
      this.requestRender();
      return;
    }
    if (item.conflict) {
      this.status =
        item.conflict === 'built-in'
          ? `${item.displayName}: a Skill with this name is built in to Alran Code; the Store does not replace it.`
          : `${item.displayName}: a ${item.kind} with this name is already installed outside the Store; it is left alone.`;
      this.requestRender();
      return;
    }
    if (item.installed && !item.updateAvailable) {
      this.status = `${item.displayName} is installed (${item.installedVersion ?? item.version ?? 'unknown version'}).`;
      this.requestRender();
      return;
    }
    await this.run(`Fetching ${item.displayName}…`, async () => {
      if (!item.entry) {
        if (item.origin !== 'official') return `${item.displayName} has nothing to install.`;
        await this.options.actions.installOfficial(item);
        return `${item.displayName} installed.`;
      }
      const staged = await this.options.actions.stage(item);
      if (staged.inspection.requiresConsent) {
        this.pending = { item, staged };
        return `${item.displayName} needs your approval before it is installed.`;
      }
      return this.commit(item, staged, false);
    }, { summary: `Couldn't install ${item.displayName}.`, nextStep: 'Retry, or run alran plugin install for details.' });
  }

  private async approvePending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    await this.run(`Installing ${pending.item.displayName}…`, () => this.commit(pending.item, pending.staged, true), {
      summary: `Couldn't install ${pending.item.displayName}.`,
      nextStep: 'Retry, or run alran plugin install for details.',
    });
  }

  private async commit(item: StoreItem, staged: StagedInstall, consent: boolean): Promise<string> {
    const verb = staged.replacesVersion === undefined ? 'Installed' : 'Updated';
    const outcome = await this.options.actions.commit(staged, consent);
    const suffix = outcome.warnings.length ? ` ${outcome.warnings.join(' ')}` : '';
    return `${verb} ${item.displayName} ${staged.entry.version}${item.kind === 'plugin' ? ' — enabled' : ''}.${suffix}`;
  }

  private async toggle(item: StoreItem): Promise<void> {
    await this.run(`Updating ${item.displayName}…`, async () => {
      await this.options.actions.setEnabled(item, !item.enabled);
      return `${item.displayName}: ${item.enabled ? 'disabled' : 'enabled'}.`;
    }, { summary: `Couldn't update ${item.displayName}.`, nextStep: 'Retry or run alran plugin for details.' });
  }

  private async remove(item: StoreItem): Promise<void> {
    await this.run(`Removing ${item.displayName}…`, async () => {
      const warnings = await this.options.actions.remove(item);
      return `Removed ${item.displayName}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`;
    }, { summary: `Couldn't remove ${item.displayName}.`, nextStep: 'Retry or run alran plugin remove for details.' });
  }

  private async reload(refresh: boolean): Promise<void> {
    await this.run(refresh ? 'Asking the stores…' : 'Reloading…', async () => {
      this.catalog = await this.options.actions.reload({ refresh });
      this.resetSelection();
      const failed = this.catalog.sources.filter((status) => status.error);
      return failed.length
        ? `Refreshed; ${failed.length} store${failed.length === 1 ? '' : 's'} could not be read (see Stores).`
        : 'Stores refreshed.';
    }, { summary: "Couldn't refresh the stores.", nextStep: 'Retry with Ctrl+R.' });
  }

  /** Runs one action with a busy indicator, then re-reads the catalog and keeps the selection. */
  private async run(
    working: string,
    operation: () => Promise<string>,
    failure: { readonly summary: string; readonly nextStep: string },
  ): Promise<void> {
    this.busy = true;
    this.status = working;
    this.requestRender();
    const previousId = this.selected()?.id;
    try {
      const message = await operation();
      if (this.disposed) return;
      if (!this.pending) {
        try {
          this.catalog = await this.options.actions.reload({ refresh: false });
        } catch {
          // The action itself worked; the list simply stays as it was.
        }
        this.restoreSelection(previousId);
      }
      this.status = message;
    } catch (error) {
      if (this.disposed) return;
      this.status = formatTuiActionFailure(error, failure);
    } finally {
      if (!this.disposed) {
        this.busy = false;
        this.requestRender();
      }
    }
  }

  private restoreSelection(id: string | undefined): void {
    const rows = this.rows();
    const index = id === undefined ? -1 : rows.findIndex((row) => (row as StoreItem).id === id);
    this.selectedIndex = index >= 0 ? index : Math.min(this.selectedIndex, Math.max(0, rows.length - 1));
    this.bodyViewport.setActiveRow(this.selectedIndex, true);
  }

  private requestRender(): void {
    if (!this.disposed) this.options.requestRender();
  }
}

// ------------------------------------------------------------------- rows

function rowState(item: StoreItem): string {
  if (isBuiltIn(item)) return 'built in';
  if (item.conflict) return item.conflict === 'built-in' ? 'name taken' : 'local copy';
  if (!item.installed) return '';
  if (item.updateAvailable) return 'update ↑';
  if (item.kind === 'plugin' && !item.enabled) return 'disabled';
  return 'installed';
}

function renderItemRow(item: StoreItem, selected: boolean, width: number, showKind: boolean): string {
  const left = `${selected ? '›' : ' '} ${itemMarker(item)} ${clean(item.displayName)}`;
  const parts = [
    item.version ? `v${item.version}` : '',
    showKind ? (item.kind === 'plugin' ? 'Plugin' : 'Skill') : clean(item.group ?? ''),
    item.summary,
    rowState(item),
  ].filter(Boolean);
  const detail = parts.join(' · ');
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(detail));
  const state = rowState(item);
  const colored =
    state === 'update ↑' ? chalk.hex(colors.warning)(detail) : chalk.hex(colors.muted)(detail);
  return `${selected ? chalk.bold.hex(colors.signal)(left) : chalk.hex(colors.text)(left)}${' '.repeat(gap)}${colored}`;
}

function renderSourceRow(status: StoreSourceStatus, selected: boolean, width: number): string {
  const label = clean(status.source.label ?? status.source.id);
  const left = `${selected ? '›' : ' '} ${status.index ? '[*]' : '[!]'} ${label}`;
  const detail = status.index
    ? `${status.index.plugins.length} Plugins · ${status.index.skills.length} Skills${status.stale ? ' · cached copy' : ''}`
    : 'not readable';
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(detail));
  return `${selected ? chalk.bold.hex(colors.signal)(left) : chalk.hex(colors.text)(left)}${' '.repeat(gap)}${chalk.hex(status.index ? colors.muted : colors.warning)(detail)}`;
}

// ----------------------------------------------------------------- details

function wrap(text: string, width: number, indent = ''): string[] {
  return wrapTextWithAnsi(`${indent}${clean(text)}`, Math.max(10, width));
}

/** At most `max` lines; when some are dropped the last one ends in an ellipsis. */
function clamp(lines: string[], max: number, width: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1] ?? '';
  kept[max - 1] = `${truncateToWidth(`${last}  `, Math.max(1, width - 1), '')}…`;
  return kept;
}

function itemDetail(item: StoreItem | undefined, width: number): string[] {
  if (!item) return [chalk.hex(colors.muted)('Select something to see what it does.')];
  const facts = [
    item.version ? `v${item.version}` : '',
    item.author ? `by ${clean(item.author)}` : '',
    clean(item.group ?? ''),
    clean(item.license ?? ''),
    item.origin === 'ottili' || isBuiltIn(item) ? '' : `from ${item.origin}`,
  ].filter(Boolean);
  const lines = [
    `${chalk.bold.hex(colors.text)(clean(item.displayName))}${facts.length ? chalk.hex(colors.muted)(`  ${facts.join(' · ')}`) : ''}`,
    ...clamp(wrap(item.description || 'No description.', width), 3, width).map((line) => chalk.hex(colors.muted)(line)),
  ];
  const entry = item.entry;
  if (entry?.kind === 'plugin') {
    const names = entry.contents.skills.map((skill) => skill.name);
    if (names.length) lines.push(...clamp(wrap(`Skills: ${names.join(', ')}`, width), 2, width).map((line) => chalk.hex(colors.dim)(line)));
    const query = entry.exampleQueries[0];
    if (query) lines.push(chalk.hex(colors.dim)(truncateToWidth(`Try: “${clean(query)}”`, width, '…')));
    if (entry.contents.mcpServers.length || entry.contents.hooks || entry.contents.apps.length) {
      lines.push(chalk.hex(colors.warning)('Runs commands or connects to services; you approve the list before it installs.'));
    }
  }
  lines.push(actionLine(item));
  return lines;
}

function actionLine(item: StoreItem): string {
  if (isBuiltIn(item)) return chalk.hex(colors.muted)('Built in to Alran Code · always available');
  if (item.conflict === 'built-in') {
    return chalk.hex(colors.warning)('A Skill with this name is built in to Alran Code; the Store does not replace it.');
  }
  if (item.conflict) {
    return chalk.hex(colors.warning)(`A ${item.kind} with this name is installed outside the Store; the Store leaves it alone.`);
  }
  if (!item.installed) {
    return item.entry || item.origin === 'official'
      ? chalk.hex(colors.accent)('Not installed · Enter installs it')
      : chalk.hex(colors.muted)('Not installed');
  }
  if (item.updateAvailable) {
    return chalk.hex(colors.warning)(`Update available: ${item.installedVersion ?? '?'} → ${item.version ?? '?'} · Enter updates`);
  }
  const toggle = item.kind === 'plugin' ? (item.enabled ? ' · Space turns it off' : ' · Space turns it on') : '';
  return chalk.hex(colors.success)(`Installed${item.installedVersion ? ` ${item.installedVersion}` : ''}${toggle} · Delete removes it`);
}

function approvalLines(pending: PendingApproval, width: number): string[] {
  const { item, staged } = pending;
  return [
    chalk.bold.hex(colors.warning)(`${clean(item.displayName)} ${staged.entry.version} will run commands or connect to services:`),
    ...staged.inspection.executes.slice(0, MAX_DETAIL_LINES - 3).flatMap((note) =>
      wrap(note.line, width - 4).slice(0, 2).map((line, index) => `${index === 0 ? '  • ' : '    '}${line}`),
    ),
    ...(staged.inspection.executes.length > MAX_DETAIL_LINES - 3
      ? [chalk.hex(colors.muted)(`  … and ${staged.inspection.executes.length - (MAX_DETAIL_LINES - 3)} more (alran plugin info ${item.name})`)]
      : []),
    chalk.hex(colors.accent)('Enter approves and installs · Esc cancels'),
  ];
}

function sourceDetail(status: StoreSourceStatus | undefined, width: number): string[] {
  if (!status) {
    return [
      chalk.hex(colors.muted)('No store is configured yet.'),
      chalk.hex(colors.dim)('Add one with: alran plugin marketplace add <url>'),
    ];
  }
  const lines = [
    chalk.bold.hex(colors.text)(clean(status.source.label ?? status.source.id)),
    chalk.hex(colors.muted)(truncateToWidth(clean(status.source.url), width, '…')),
  ];
  if (status.index?.description) lines.push(...clamp(wrap(status.index.description, width), 2, width).map((line) => chalk.hex(colors.muted)(line)));
  if (status.error) {
    lines.push(
      ...wrap(
        status.index ? `Unreachable, showing a cached copy: ${status.error}` : `Could not be read: ${status.error}`,
        width,
      ).slice(0, 3).map((line) => chalk.hex(colors.warning)(line)),
    );
  }
  lines.push(chalk.hex(colors.dim)('Add a store with: alran plugin marketplace add <url>'));
  return lines;
}
