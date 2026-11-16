# LaTeX Template for Chinese Technical Publications

This is a LaTeX template for publishing Chinese technical books. It suits computer science
textbooks, algorithm books, systems design books, and engineering practice monographs. The template
uses a B5 / 16-mo approximate size of `176mm × 250mm`, which is closer to a real Chinese technical
book proof than A4.

## Compilation

```bash
latexmk -xelatex -interaction=nonstopmode main.tex
```

Or manually:

```bash
xelatex main.tex
bibtex main
makeindex main
xelatex main.tex
xelatex main.tex
```

## File structure

```text
technical-book-latex-template/
├── main.tex
├── references.bib
├── frontmatter/
│   ├── copyright.tex
│   └── preface.tex
├── chapters/
│   ├── chapter01.tex
│   ├── chapter02.tex
│   ├── chapter03.tex
├── backmatter/
│   └── appendix.tex
└── figures/
```

## Main features

- B5 / 16-mo Chinese technical book layout: `176mm × 250mm`.
- Two-sided typesetting; chapters start on a right-hand page by default.
- Chinese environment names: definition, theorem, example, key point, common pitfall, exercise, and
  further reading for the chapter.
- Supports algorithm pseudocode, code listings, tables, bibliography, and index.
- Uses `hyperref` to generate a clickable table of contents and cross references.

## Recommendations before formal publication

Before delivering to a publisher, confirm: trim size, text block, margins, font licensing, ISBN,
copyright page, CIP information, figure resolution, and print bleed specifications.

## Current style

This template has been updated to match the technical publishing style of the `harness-book`
finished-book edition, while keeping generic placeholder content:

- O'Reilly / technical-animal cover style, using a TikZ animal line drawing as the placeholder by
  default; the old cover is kept as `\maketechbooktitleClassic` and is not compiled by default.
- Table of contents numbering and page numbers use red accents; the body table-of-contents text
  stays black.
- The body includes styles for drop caps, pull quotes, callout boxes, diagram boxes, low-saturation
  code highlighting, and inline code paths with automatic line breaking.
- The header shows only the current section title; the footer shows the book title, the publisher
  mark, and the page number.

When producing the finished book, replace the book metadata, preface, chapter files, and cover
illustration in `main.tex`.
