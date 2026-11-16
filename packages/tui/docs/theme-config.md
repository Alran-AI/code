# Theme configuration guide

The colours of the alran TUI are decided by a **named theme**. Every theme provides a dark and a
light palette. The terminal's light or dark background is detected automatically from the terminal
evidence; on top of that, `/theme` lets the user switch themes, lock the appearance, and write
their own theme files.

## TL;DR

Type `/theme` to open the theme panel:

- `↑` / `↓` move the cursor and **preview the palette live**; `Enter` saves and applies it
  immediately, `Esc` / `Ctrl+C` cancels and restores the theme that was active when the panel
  opened.
- `a` cycles between "automatic / light / dark". The automatic mode follows the terminal detection
  result and, once locked, is no longer overridden by the terminal evidence.
- Each row carries a colour bar on the right; the bottom of the panel shows the current
  appearance, where the theme comes from, and a description.
- The theme selection is written to `tui/tui-settings.json` in the runtime data directory. If the
  write fails, the panel stays open with a message and the current selection is not lost.
- `/theme` is a `search-only` command: you can type `/theme` directly and find it in the command
  search, but it does not appear in the default slash list.

## Built-in themes

| Theme ID | Name | Character |
| --- | --- | --- |
| `alran` | Alran | The default theme. Alran blue with Catppuccin syntax highlighting |
| `midnight` | Midnight | A deeper blue-black background with higher foreground contrast |
| `graphite` | Graphite | Neutral, low-chroma surfaces that stay quiet on long output |
| `aurora` | Aurora | A secondary colour scale leaning towards cyan and green |

Every theme defines a complete dark and a complete light version, so a terminal that switches to a
light background never ends up with missing or mismatched colours. The values of `alran` are
exactly the ones from before the theme system was introduced, so existing users see no visual
change.

The text colour and the non-text `line` colour of the built-in themes have to meet the
[WCAG AA contrast](./tui-foundation.md#themes-and-terminal-capabilities) baseline (4.5:1 for text,
3:1 for non-text). `packages/tui/test/unit/tui/theme/palettes.test.ts` regression-checks this for
every theme and every appearance.

## Where the configuration lives

- File: `~/.alran/tui/tui-settings.json` (that is `tui/tui-settings.json` in the runtime data
  directory).
- Key: `theme`, whose value is a theme ID, or `themeID/light` and `themeID/dark` to lock the
  appearance.

```json
{
  "tuiMode": "regular",
  "theme": "midnight"
}
```

`theme` and `tuiMode` live in the same file, and writing one of them does not overwrite the other;
unknown keys in the file are kept as they are. A `theme` value that cannot be recognised falls back
to the default theme and does not block the start.

## Custom theme files

Alran reads user themes from `tui/themes/*.json` in the runtime data directory.

- One file provides one appearance. `aurora.json` provides the dark appearance, `aurora-light.json`
  the light one; two files with the same `name` form one selectable theme.
- An appearance that is not provided falls back to the palette of the default theme for that
  appearance, so a dark-only file works on its own.
- The file name can be any `.json`; the theme ID is the `name` inside the file. The `name` may not
  contain a `/` and may not be the ID of a built-in theme (built-in themes win; a conflicting file
  is ignored and reported in the load issues).
- **Hot reload**: editing a custom theme file that is in use applies the change on save, without a
  restart.

### File format

```json
{
  "name": "my-theme",
  "label": "My Theme",
  "description": "A custom Alran palette",
  "appearance": "dark",
  "vars": {
    "brand": "#68c0ff",
    "gray": "#949494"
  },
  "colors": {
    "brand": "brand",
    "signal": "brand",
    "accent": "brand",
    "text": "#d6d6d6",
    "muted": "gray",
    "line": "gray"
  },
  "syntax": {
    "text": "#cdd6f4",
    "mauve": "#cba6f7",
    "overlay2": "#9399b2"
  }
}
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The theme ID, `[a-z0-9][a-z0-9._-]{0,63}` |
| `appearance` | yes | `dark` or `light` |
| `label` / `description` | no | The name and the description shown in the panel |
| `vars` | no | Reusable colour aliases |
| `colors` | yes | The UI colour object; only the fields to override need to be listed |
| `syntax` | no | The syntax highlighting palette; tones that are not listed keep the default theme's |

The values of `colors` and `syntax` can be:

- **hex literals**: `"#68c0ff"` or the three-digit shorthand `"#6cf"`.
- **`vars` references**: the name of an alias defined in `vars`.
- **the empty string** `""`: the terminal's default colour.

A `vars` value can only be a hex literal or the empty string — **nested references are not
supported** (`vars.a` may not point at another `vars` key). Such a definition is rejected while
loading, with an error that names the exact path.

Listing only some of the `colors` fields is enough; the rest keep the values of the default theme
for that appearance — so a new theme only has to describe its differences.

### Available fields

`colors` supports these 21 keys:

`brand`, `wordmarkHighlight`, `wordmarkShadow`, `signal`, `orbit`, `accent`, `markdownHeading`,
`markdownCode`, `markdownLink`, `userMessageBg`, `diffAddedBg`, `diffRemovedBg`, `text`, `muted`,
`dim`, `border`, `line`, `success`, `warning`, `error`.

`syntax` supports these 13 tones:

`blue`, `flamingo`, `green`, `mauve`, `overlay2`, `peach`, `pink`, `red`, `sapphire`, `subtext0`,
`teal`, `text`, `yellow`.

Custom themes do not take part in the contrast regression of the built-in themes. On a terminal
that supports only 16 colours, the UI colours map to the terminal's semantic colours and the
syntax colours use a fixed ANSI16 mapping (the same as the built-in themes).

## Terminal capabilities and degradation

A theme only consumes the detected terminal capabilities and changes no business semantics:

- The light or dark background prefers the result of the OSC 11 query, then the terminal's DEC 2031
  report, and falls back to `COLORFGBG` last;
- once the appearance is locked (press `a` in `/theme`, or write `themeID/dark` in the configuration),
  the terminal evidence no longer changes it;
- ANSI16 / 256 / truecolor degrade step by step, and the text hierarchy survives on a terminal
  without colour support.

## Related files

| Path | Responsibility |
| --- | --- |
| `src/tui/theme/contracts.ts` | The type contracts of themes, palettes and syntax palettes |
| `src/tui/theme/palettes.ts` | The built-in theme definitions and the default theme |
| `src/tui/theme/custom-themes.ts` | Discovery, validation, loading and hot reload of custom theme files |
| `src/tui/theme/registry.ts` | Merging, resolving and falling back of built-in and custom themes |
| `src/tui/theme/controller.ts` | Theme selection, appearance locking and terminal brightness detection |
| `src/tui/theme/runtime.ts` | The live binding of colours and syntax palettes |
| `src/tui/features/settings/theme-picker.ts` | The `/theme` panel |
| `src/host/tui-settings.ts` | Reading and writing `tui-settings.json` |
