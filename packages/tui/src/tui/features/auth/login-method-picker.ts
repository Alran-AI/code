import { panelLayout } from '../../widgets/panel-frame.js';
import type { Component } from '../../rendering/component.js';
import {
  tuiChalk as chalk,
  tuiColors as colors,
  tuiSelectListTheme as theme,
} from '../../theme/runtime.js';
import { SelectList } from '../../widgets/select-list.js';

/** How `alran login` obtains credentials for the Ottili AI Platform. */
export type TuiLoginMethod = 'platform' | 'api-key';

const LOGIN_METHODS: readonly {
  value: TuiLoginMethod;
  label: string;
  description: string;
}[] = [
  {
    value: 'platform',
    label: 'Ottili account (OAuth)',
    description: 'Sign in with your Ottili account in the browser',
  },
  {
    value: 'api-key',
    label: 'API key',
    description: 'Paste an Ottili API key (sk-ottili-…)',
  },
];

export class TuiLoginMethodPicker implements Component {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private readonly list: SelectList;

  constructor(onSelect: (method: TuiLoginMethod) => void, onCancel: () => void) {
    this.list = new SelectList([...LOGIN_METHODS], LOGIN_METHODS.length, theme, {
      minPrimaryColumnWidth: 22,
      maxPrimaryColumnWidth: 30,
    });
    this.list.onSelect = (item) => onSelect(item.value as TuiLoginMethod);
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
    const layout = panelLayout(width, height, '↑↓ select · Enter continue · Esc cancel');
    const helper =
      layout.bodyHeight >= 4
        ? [chalk.hex(colors.muted)('Both methods unlock the same Ottili AI models.')]
        : [];
    return layout.render({
      title: 'Sign in to Ottili',
      body: [
        ...helper,
        ...this.list.renderViewport(layout.contentWidth, layout.bodyHeight - helper.length),
      ],
    });
  }
}
