import { TuiMascotPanel } from '../../features/mascot/panel.js';
import type { TuiInteractionSurface } from '../../shell/interaction-surface.js';

/**
 * Opens the animated little man in the single-slot interaction region.
 *
 * The panel owns its own timer and disposes it when the surface closes, so
 * opening `/mascot` twice replaces the first visit instead of stacking timers.
 */
export function showTuiMascot(options: {
  readonly surface: Pick<TuiInteractionSurface, 'show' | 'close' | 'request'>;
}): void {
  const panel = new TuiMascotPanel({
    requestRender: () => options.surface.request(),
    onClose: () => {
      options.surface.close(panel);
    },
  });
  options.surface.show(panel);
}
