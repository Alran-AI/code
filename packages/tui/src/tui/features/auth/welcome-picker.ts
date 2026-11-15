import { panelLayout } from '../../widgets/panel-frame.js';
import type { Component } from '../../rendering/component.js';
import {
  tuiChalk as chalk,
  tuiColors as colors,
  tuiSelectListTheme as theme,
} from '../../theme/runtime.js';
import { SelectList } from '../../widgets/select-list.js';

/** What a person can do first: the ways into Alran Code, and the way to look around without one. */
export type TuiWelcomeChoice = 'platform' | 'api-key' | 'provider' | 'skip';

const CHOICES: readonly { value: TuiWelcomeChoice; label: string; description: string }[] = [
  {
    value: 'platform',
    label: 'Sign in with Ottili',
    description: 'Your Ottili account (browser or code); welcome credit included',
  },
  {
    value: 'api-key',
    label: 'Use an API key',
    description: 'Paste an Ottili API key (sk-ottili-…)',
  },
  {
    value: 'provider',
    label: 'Use my own provider',
    description: 'OpenRouter or any OpenAI-compatible endpoint',
  },
  {
    value: 'skip',
    label: 'Skip for now',
    description: 'Look around first; /login and /provider are always there',
  },
];

/**
 * Shown once, at the first start without an account or a provider. Optional by construction: Esc or "Skip"
 * closes it and leaves the composer exactly as it was.
 */
export class TuiWelcomePicker implements Component {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private readonly list: SelectList;

  constructor(onSelect: (choice: TuiWelcomeChoice) => void, onCancel: () => void) {
    this.list = new SelectList([...CHOICES], CHOICES.length, theme, {
      minPrimaryColumnWidth: 22,
      maxPrimaryColumnWidth: 30,
    });
    this.list.onSelect = (item) => onSelect(item.value as TuiWelcomeChoice);
    this.list.onCancel = onCancel;
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return this.renderViewport(width, 20);
  }

  renderViewport(width: number, height: number): string[] {
    const layout = panelLayout(width, height, '↑↓ select · Enter continue · Esc skip');
    const helper =
      layout.bodyHeight >= 5
        ? [
            chalk.hex(colors.muted)('Alran Code runs on the Ottili AI Platform, on your own provider, or on both.'),
            '',
          ]
        : [];
    return layout.render({
      title: 'Welcome to Alran Code',
      body: [
        ...helper,
        ...this.list.renderViewport(layout.contentWidth, layout.bodyHeight - helper.length),
      ],
    });
  }
}
