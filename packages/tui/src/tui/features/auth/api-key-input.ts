import { matchesKey } from '../../engine/public.js';
import type { Component, Focusable } from '../../rendering/component.js';
import { panelLayout } from '../../widgets/panel-frame.js';
import { Input } from '../../widgets/input.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';

/**
 * Collect an Ottili API key inside the TUI.
 *
 * Signing in with a key needs no network: the Platform mints the key in the
 * browser, and the pasted `sk-ottili-…` value is stored in the local config.
 */
export class TuiApiKeyInput implements Component, Focusable {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private readonly input = new Input();
  private _focused = false;

  constructor(
    private readonly onSubmit: (apiKey: string) => void,
    private readonly onCancel: () => void,
  ) {}

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'enter')) {
      const apiKey = this.input.getValue().trim();
      if (apiKey.length > 0) this.onSubmit(apiKey);
      return;
    }
    if (matchesKey(data, 'escape')) {
      this.onCancel();
      return;
    }
    this.input.handleInput(data);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    return this.renderViewport(width, 20);
  }

  renderViewport(width: number, height: number): string[] {
    const layout = panelLayout(width, height, 'Enter sign in · Esc cancel');
    const helper =
      layout.bodyHeight >= 4
        ? [
            chalk.hex(colors.muted)(
              'Create a key in the Ottili console (settings → API keys), then paste it here.',
            ),
          ]
        : [];
    return layout.render({
      title: 'Ottili API key',
      body: [...helper, ...this.input.render(layout.contentWidth)],
    });
  }
}
