# Templates Index

Eight production-grade PDF templates — every CREATE / REFORMAT skeleton renders via Playwright
HTML+CSS → PDF (no token pipeline, no LaTeX). Use them as starting points; copy, re-skin, and
render.

> **Diversity reminder.** Each skeleton ships with a baseline palette, fonts, and section ordering
> so the layout demo works out-of-the-box. **Adapt these to the user's brand, topic, mood, or
> audience every time** — do not return three different documents using the same bronze/gold (menu)
> or navy (research report) palette. Each README §7 lists the **structural invariants** you must
> keep and the **swappables** you should vary.

| Slug                      | Route                | Use case                                         | Trigger keywords                                          |
| ------------------------- | -------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| bilingual-menu-premium    | CREATE               | Premium bilingual menus                          | "menu", "bilingual menu", "餐厅菜单"                      |
| brand-guide-2page         | CREATE               | 2-page brand guide                               | "brand guide", "design system"                            |
| data-viz-report           | CREATE               | Chart-rich data analysis brief                   | "data report", "可视化", "benchmark", "图文报告"          |
| multi-article-aggregator  | CREATE               | Article digest / anthology                       | "article digest", "newsletter"                            |
| multilang-research-report | CREATE               | Multi-country research report                    | "research report", "regulatory survey"                    |
| reformat-default          | REFORMAT             | Default markdown / text / pdf reformat           | "reformat", "markdown to PDF", "重排版"                   |
| translate-preserve-layout | REFORMAT             | Translate while preserving layout                | "translate PDF", "翻译保版"                               |
| form-fill-acroform        | FILL                 | Government / official form fill                  | "fill form", "visa form", "签证表"                        |
| latex-technical-book      | LATEX_TECHNICAL_BOOK | Chinese technical books / engineering monographs | "技术书", "源码解析书", "LaTeX 技术出版", "O'Reilly 风格" |

## Usage

### CREATE — copy a skeleton, fill placeholders, render

```bash
# 1. Pick a template
cat templates/INDEX.md            # the file you are reading
cat templates/<slug>/README.md    # 7-section recipe (when-to-use → generalization)

# 2. Copy the skeleton + edit
cp templates/<slug>/skeleton.html /tmp/work/page.html
$EDITOR /tmp/work/page.html       # replace <!-- PLACEHOLDER --> tokens

# 3. Render (15s settle if Chart.js is on the page)
bash scripts/make.sh render --in /tmp/work/page.html --out /tmp/work/out.pdf --wait 15000

# 4. Verify
pdfinfo /tmp/work/out.pdf | grep Pages
open /tmp/work/out.pdf
```

### REFORMAT — single-command markdown → PDF

```bash
bash scripts/make.sh reformat \
  --input doc.md --out report.pdf \
  --title "My Report" --author "Jane" --accent "#0a7488"
```

The `reformat-default` template is auto-applied. Pass `--template <slug>` to use a different
`templates/reformat-*/` skeleton.

### FILL — see [form-fill-acroform/README.md](form-fill-acroform/README.md)

```bash
bash scripts/make.sh fill probe form.pdf
```

## Per-template files

Each `templates/<slug>/` contains:

- `README.md` — the full seven-section recipe (when-to-use / pipeline / shape / visual / skeleton /
  pitfalls / generalization).
- `skeleton.html` (or `skeleton.json` / `pipeline.md`) — a copy-and-edit starting point with
  placeholders marked `<!-- PLACEHOLDER -->`.
- A small helper file when relevant (`terminology.template.json`, `field_values.template.json`).

## Case exemplars

| Case                                           | Source                                                                         | Use when                                                                                                                                                                                                                                                             | Files                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chinese technical book (LaTeX)                 | Structured HTML / Markdown chapters for a technical book                       | Long-form source-code reading or engineering book needs B5 book typography, O'Reilly-like cover, clickable TOC, code blocks, callouts, and diagrams; read `../docs/latex-technical-book-guide.md` first                                                              | `latex-technical-book/source.tex`; `latex-technical-book/README.md`                                                                                                                                                                                      |

## When nothing matches

- Document is structurally close to a template → **adapt the closest one** and re-skin (palette +
  cover archetype). Faster than from-zero authoring.
- Completely different shape → hand-author HTML following
  [`../docs/html-pdf-spec.md`](../docs/html-pdf-spec.md) (the mechanical contract) and
  [`../docs/design-guide.md`](../docs/design-guide.md) (the aesthetic contract). Copy individual
  primitives (KPI grid, chart card, pill table, conclusion block) from
  `data-viz-report/skeleton.html`.
- Still unsure → read a reference PDF first via the READ route:
  `python3 -m scripts.read_pdf_vision --input <reference.pdf> --pages 1`, understand the structure,
  then choose.
