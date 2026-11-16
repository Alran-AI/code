# Description Rubric — the four parts of a good description

> `description` is the only signal the LLM uses to decide whether to open a skill. Written badly it means the skill is never used when it should be (missed trigger), or used when it should not be (false trigger). This document lists the four parts and uses existing Alran skills as positive and negative examples.

## The four parts

Every description must let another LLM answer all four questions at once:

1. **What**: what this skill can do (one sentence, the capability boundary)
2. **When**: what the user would say for it to trigger (including concrete phrases/keywords)
3. **Near misses**: what adjacent requests should **not** trigger it
4. **Moderately pushy**: widen recall while stating a clear boundary, so it does not stay "vaguely usable"

## Example 1: the boundary between skill-creator and skill-refiner

Both skills handle skills, but they cover different delivery stages: one creates a new skill, the other improves an existing one.

**skill-creator**:
> Use when the user wants to create a new reusable Skill from requirements, examples, or an existing workflow. Do not use it merely to review or tune an existing Skill.

**skill-refiner**:
> Use when the user wants to review, debug, evaluate, or improve an existing Skill. Do not use it to scaffold a brand-new Skill from scratch.

**Why both are written well**:
- Both state the delivery stage: new versus existing
- Both spell out the exclusion condition for adjacent requests
- The input objects and the target states differ, so they do not trigger together

## Example 2: separating docx from pptx

Both skills handle Office documents, but the file types and the deliverables differ:

**docx**:
> Create, inspect, edit, repair, and verify Microsoft Word DOCX documents. Use this skill for formal Word deliverables, tracked document structure, WordprocessingML-level edits, rendering DOCX pages for visual QA, extracting text/styles/tables/images/comments, or preserving DOCX layout and section/header/footer behavior.

**pptx**:
> Read, inspect, generate, and edit PowerPoint PPTX presentations. Use this skill for extracting slide text, speaker notes, comments, embedded images, screenshots, metadata audits, creating new decks with PptxGenJS, imitating a reference deck's visual style, or editing an existing PPTX while preserving layout.

**What makes them work**:
- Both name the file type first (DOCX / PPTX), so the model can route quickly from the extension and the deliverable
- `docx` puts the Word-specific section/header/footer, WordprocessingML, and page render QA into the boundary
- `pptx` puts slide, speaker notes, screenshots, PptxGenJS, and reference deck imitation into the boundary
- Neither description falls back on a vague "Office file" wording, which would let any Office request trigger the same skill

## Anti-patterns: what a badly written description looks like

**Anti-pattern A** (too abstract, unstable triggering):
```
description: A useful skill for working with files.
```
Problem: which files? Which operations? The model does not know when to use it.

**Anti-pattern B** (only a pile of keywords, no when and no boundary):
```
description: PDF, text, extract, OCR, parse, document, file
```
Problem: any request that mentions PDF may trigger it, including requests that should use `docx` or another adjacent skill.

**Anti-pattern C** (drops "when not to use it"):
```
description: Use this skill to handle PDF files.
```
Problem: it also triggers when the user says "generate a PDF report".

## Self-check list

After writing the description, check it with these four questions:

- [ ] Does it say in one sentence what it does?
- [ ] Does it give at least 2 concrete trigger phrases (in both languages if the user mixes them)?
- [ ] Does it explicitly list the adjacent cases that should not trigger it?
- [ ] Is it moderately pushy (clear wording such as "load this skill when" / "trigger on") without exaggerating the capability?

## How far to push ("moderately pushy")

**Too weak**: `Can be useful for X` → the LLM cannot tell whether to use it
**Right**: `Use this skill when X. Triggers on phrases like Y / Z` → clear recall intent
**Too much**: `MUST always use this skill for any X-related task` → it locks the model down and overfits instead

Reference the way existing Alran skills write their description (for example `lark-tools`):
> Use this skill **whenever** the user mentions anything related to Feishu or Lark, including but not limited to: ...

`whenever` + `including but not limited to` is the moderately pushy example: wider recall plus room to extend.
