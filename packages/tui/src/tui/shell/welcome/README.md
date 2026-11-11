# Welcome UI maintenance

Welcome separates design assets, layout, and terminal mechanics. Designers generally only need to edit this directory.

- `design.ts` is the single visual configuration entry point: character logo, wordmark, slogan, tips, news, and responsive hero thresholds.
- `component.ts` owns wide, stacked, and compact layouts, not theme detection or runtime lifecycle.
- `hero.ts` maps design assets to the current theme's gradient hero. Change it only when adjusting responsive selection or coloring.

Welcome and `/changelog` share the local changelog bundled with the package (`CHANGELOG.md`, English). For each release, keep at least three entries under the version heading for Welcome.

The hero uses the same ASCII block wordmark family: the five-line `ALRAN CODE` art at 79 columns or more, and the matching five-line `ALRAN` art (without `CODE`) from 41 columns. Only terminals narrower than 41 columns fall back to the single word `ALRAN`. The art is painted with the brand purple gradient from `#4c1d95` to `#a855f7`, top line to bottom line, and the `Powered by Ottili AI Platform` tagline is centered underneath the full wordmark in a muted color. Do not invent a separate pixel font. Compact Welcome still renders the hero; the frame header shows version and activity, not a second product-name line.

Shared colors live in `src/tui/theme/palettes.ts`; borders and terminal-width adaptation live in `src/tui/shell/frame.ts`. Initial theme detection and rendering gates belong to infrastructure in `src/tui/theme/render-binding.ts` and `src/tui/renderer/interactive-renderer.ts`. Do not add startup sequencing to Welcome.

Validate copy, colors, and artwork visually. For responsive layout, visibility, or state changes in this standalone repository, run the relevant test from the repository root:

```bash
pnpm exec vitest run --config vitest.oss.config.mjs packages/tui/test/unit/tui-shell-chrome.test.ts
```
