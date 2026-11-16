#!/usr/bin/env node
// The language gate: the published source carries no Chinese-language prose.
//
// The product ships a Chinese locale and can produce Chinese documents, so a
// number of files carry Chinese on purpose. Every one of them is listed in
// ALLOWED_FILES below with the reason why it is there. Everywhere else a
// Chinese character is a leftover from the code base this project was derived
// from and has to go.
//
// The gate reads the same file set as the brand gate: the tracked files plus
// the untracked ones that are not ignored.
//
// When a build output is present, it is read as well. The assets in the output
// are verbatim copies of the sources, so the source scan already covers them.
// The bundled files have no single source: every run of Chinese characters in
// them has to occur in a source file that is allowed to carry Chinese, so the
// bundle cannot smuggle Chinese into the product either.
//
// Usage: node scripts/check-language.mjs [--json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Han, Hiragana, Katakana, Hangul and the CJK punctuation marks.
 *
 * The ranges are written as escapes so that this file does not contain the
 * characters it looks for.
 */
const CJK_PATTERN =
  /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;

/**
 * A maximal run of Chinese characters, without the punctuation.
 *
 * The punctuation is covered by CJK_PATTERN. Here it only breaks the runs
 * apart, so that a run of text can be compared with the text of a source file.
 */
const CJK_SEGMENT_PATTERN =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/gu;

/**
 * The files that may carry Chinese, with the reason.
 *
 * Three kinds of file are listed:
 *   - the Chinese locale of the product and the channels that serve Chinese
 *     users (WeChat, Feishu);
 *   - the documents and templates that produce Chinese documents (CJK
 *     typography, Chinese LaTeX templates, bilingual templates);
 *   - the test data that exercises Chinese text handling (rendering width,
 *     IME input, Chinese numerals and punctuation).
 */
export const ALLOWED_FILES = new Map([
  // --- the Chinese locale of the product -----------------------------------
  ['packages/agent-modules/permission/src/reason-format.ts', 'the reason strings of the zh locale'],
  ['packages/agent-modules/system-reminder/src/evolution.ts', 'the memory prompt of the zh locale'],
  ['packages/agent-modules/system-reminder/src/blocks.ts', 'the reminder blocks of the zh locale'],
  ['packages/local-runtime/src/review/after-llm-hook.ts', 'the review prompts of the zh-CN region'],
  ['packages/local-runtime/src/review/tool-guard.ts', 'the review prompts of the zh-CN region'],
  ['packages/local-runtime/src/review/preparation.ts', 'the review prompts of the zh-CN region'],
  ['packages/local-runtime/src/review/hosted-capability.ts', 'the review prompts of the zh-CN region'],
  ['packages/local-runtime/src/channels/adapters/wechat/', 'WeChat serves Chinese users'],
  ['packages/local-runtime/src/channels/adapters/feishu/', 'Feishu serves Chinese users'],
  ['packages/local-runtime/src/channels/adapters/telegram/', 'the questionnaire prompts of the zh locale'],
  ['packages/local-runtime/src/channels/wechat.ts', 'WeChat serves Chinese users'],
  ['packages/local-runtime/src/channels/feishu.ts', 'Feishu serves Chinese users'],
  ['packages/local-runtime/src/channels/feishu-outbound-client.ts', 'Feishu serves Chinese users'],
  ['packages/local-runtime/src/channels/message-format.ts', 'the message templates of the zh locale'],
  ['packages/local-runtime/src/channels/outbound-message.ts', 'the message templates of the zh locale'],
  ['packages/local-runtime/src/channels/channel-im-receipts.ts', 'the receipts of the zh locale'],
  ['packages/local-runtime/src/channels/infra.ts', 'the message templates of the zh locale'],
  ['packages/local-runtime/src/channels/channel-queue-drain.ts', 'the message templates of the zh locale'],
  ['packages/local-runtime/src/api/host-feishu-card-action.ts', 'Feishu serves Chinese users'],
  ['packages/local-runtime/src/api/host-channels.ts', 'Feishu serves Chinese users'],
  ['packages/local-runtime/src/api/local-permission-approval-service.ts', 'the approval prompts of the zh locale'],
  ['packages/local-runtime/src/permissions/ask-gate.ts', 'the approval prompts of the zh locale'],
  ['packages/local-runtime/src/web-fetch/local-web-fetch-client.ts', 'the Chinese error message of the zh locale'],
  ['packages/local-runtime/src/website-deploy/local-website-deploy-client.ts', 'the Chinese error message of the zh locale'],
  ['packages/local-runtime-v2/src/service/browser-use/reminders.ts', 'the reminders of the zh locale'],
  ['packages/local-runtime-v2/src/service/turn-system/agent-host/runner/prompt-suggestion/', 'the suggestions of the zh locale'],
  ['packages/local-runtime-v2/src/service/turn-system/agent-host/runner/local-agent-turn-runner.ts', 'the suggestions of the zh locale'],
  ['packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts', 'the descriptions of the zh locale'],
  ['packages/local-runtime-v2/src/service/turn-system/agent-host/compaction/', 'the compaction markers of the zh locale'],
  ['packages/local-runtime-v2/src/service/session-system/sessions/title/session-title-service.ts', 'the titles of the zh locale'],
  ['packages/local-runtime-v2/src/service/session-system/sessions/root/archive-title-model-adapter.ts', 'the titles of the zh locale'],
  ['packages/local-runtime-v2/src/service/session-system/sessions/repo/agent-binding.ts', 'the agent names of the zh locale'],
  ['packages/local-runtime-v2/src/service/agent/application/agent-profile.ts', 'the agent descriptions of the zh locale'],
  ['packages/local-runtime-v2/src/service/agent/contracts.ts', 'the agent descriptions of the zh locale'],
  ['packages/local-runtime-v2/src/service/permission/', 'the permission prompts of the zh locale'],
  ['packages/local-runtime-v2/assets/agents/', 'the agent prompts of the zh locale'],
  ['packages/local-runtime-v2/assets/agents/_migration/general/PERSONA.md', 'the persona of the zh locale'],
  ['packages/tui/src/application/thread-goal-command.ts', 'the command text of the zh locale'],
  ['packages/agent-extension/src/source-reference.ts', 'Chinese numerals and punctuation parsing'],
  ['packages/shared/src/im-text-sanitize.ts', 'the sanitizing of Chinese punctuation'],
  ['packages/shared/src/markdown-source-citation.ts', 'the Chinese citation text of the zh locale'],
  ['packages/shared/src/agent-mention/projection.ts', 'the mention text of the zh locale'],
  ['packages/shared/src/memory-limits.ts', 'the limit text of the zh locale'],
  ['packages/shared/src/fetched-web-sources.ts', 'the source text of the zh locale'],
  ['packages/shared/src/web-source-evidence.ts', 'the source text of the zh locale'],

  // --- the Chinese triggers and examples of the bundled skills -------------
  ['packages/local-runtime/assets/skills/cu-desktop/SKILL.md', 'the Chinese example of the skill'],
  ['packages/local-runtime/assets/skills/deep-research/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/deploy-website/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/docx/SKILL.md', 'the Chinese typography terms of the skill'],
  ['packages/local-runtime/assets/skills/init/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/pdf/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/resume-codex/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/skill-creator/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime/assets/skills/visual-page/SKILL.md', 'the zh-Hans trigger of the skill'],
  ['packages/local-runtime-v2/assets/agents/alran/skills/control-in-app-browser/SKILL.md', 'the zh-Hans trigger of the skill'],

  // --- documents and templates that produce Chinese documents --------------
  ['packages/local-runtime/assets/skills/docx/references/cjk_typography.md', 'CJK typography is the subject of the guide'],
  ['packages/local-runtime/assets/skills/docx/references/cjk_university_template_guide.md', 'CJK typography is the subject of the guide'],
  ['packages/local-runtime/assets/skills/docx/references/typography_guide.md', 'CJK typography is the subject of the guide'],
  ['packages/local-runtime/assets/skills/docx/references/scenario_c_apply_template.md', 'the scenario uses a Chinese document as its example'],
  ['packages/local-runtime/assets/skills/docx/references/design_good_bad_examples.md', 'the examples show Chinese documents'],
  ['packages/local-runtime/assets/skills/docx/references/design_principles.md', 'the examples show Chinese documents'],
  ['packages/local-runtime/assets/skills/docx/references/troubleshooting.md', 'the examples show Chinese documents'],
  ['packages/local-runtime/assets/skills/docx/references/sample-patch-plans.json', 'the plans use Chinese documents as their example'],
  ['packages/local-runtime/assets/skills/docx/docs/', 'the backends list Chinese typography terms'],
  ['packages/local-runtime/assets/skills/docx/scripts/dotnet/', 'the samples carry Chinese documents'],
  ['packages/local-runtime/assets/skills/pdf/templates/latex-academic-thesis/', 'the template produces a Chinese thesis'],
  ['packages/local-runtime/assets/skills/pdf/templates/latex-technical-book/', 'the template produces a Chinese book'],
  ['packages/local-runtime/assets/skills/pdf/templates/translate-preserve-layout/', 'the template translates Chinese documents'],
  ['packages/local-runtime/assets/skills/pdf/templates/bilingual-menu-premium/', 'the template produces a bilingual menu'],
  ['packages/local-runtime/assets/skills/pdf/templates/multilang-research-report/', 'the template produces a multilingual report'],
  ['packages/local-runtime/assets/skills/pdf/scripts/read_pdf_vision.py', 'the prompt addresses Chinese documents'],
  ['packages/local-runtime/assets/skills/pdf/docs/', 'the guides use Chinese documents as their examples'],
  ['packages/local-runtime/assets/skills/xlsx/', 'the conventions cover Chinese spreadsheets'],

  // --- Chinese in the zh locale of the product, outside the runtime ---------
  ['packages/agent-tools/src/desktop/builtin-defs.ts', 'the label example of the zh locale'],
  ['packages/agent-tools/src/desktop/builtin-browser-defs.ts', 'the label example of the zh locale'],
  ['packages/local-runtime/assets/prompts/code-review/review-candidates.md', 'the review example of the zh-CN region'],
  ['packages/local-runtime-v2/assets/agents/workflow/code-review/review-candidates.md', 'the review example of the zh-CN region'],
  ['packages/browser-core/src/browser-hover-semantic.ts', 'Chinese numerals in the value check'],
  ['packages/browser-core/src/cdp-helper.ts', 'Chinese numerals in the value check'],

  // --- test data that exercises Chinese text handling -----------------------
  ['packages/tui/test/', 'the tests exercise Chinese rendering and IME input'],
  ['packages/local-runtime/test/', 'the tests exercise Chinese text handling'],
  ['packages/local-runtime-v2/test/', 'the tests exercise Chinese text handling'],
  ['packages/agent-tools/test/', 'the tests exercise Chinese text handling'],
  ['packages/agent-tools/src/shared/edit-encoding.test.ts', 'the test exercises Chinese text handling'],
  ['packages/agent-core/test/', 'the tests exercise Chinese text handling'],
  ['packages/agent-modules/', 'the tests exercise Chinese text handling'],
  ['packages/browser-core/test/', 'the tests exercise Chinese text handling'],
  ['test/', 'the tests exercise Chinese text handling'],
  ['test-vectors/', 'the vectors carry Chinese text'],
  ['scripts/perf/', 'the driver measures Chinese rendering'],
  ['packages/local-runtime/src/persistence/', 'the session history carries Chinese text'],
  ['packages/local-runtime-v2/src/service/session-system/', 'the session history carries Chinese text'],

  // --- upstream material: the CJK rendering, wrapping and IME test data ----
  // The vendored pi-mono tree carries Chinese only in the tests that measure
  // the display width, the wrapping and the IME handling of Chinese text.
  ['third_party/pi-mono/packages/agent/test/harness/truncate.test.ts', 'upstream test data: Chinese text'],
  ['third_party/pi-mono/packages/ai/test/unicode-surrogate.test.ts', 'upstream test data: Chinese and Japanese text'],
  ['third_party/pi-mono/packages/coding-agent/examples/extensions/overlay-test.ts', 'upstream test data: CJK width'],
  ['third_party/pi-mono/packages/coding-agent/test/edit-diff-fuzzy-span.test.ts', 'upstream test data: the full-width ideographic space'],
  ['third_party/pi-mono/packages/coding-agent/test/footer-width.test.ts', 'upstream test data: CJK width'],
  ['third_party/pi-mono/packages/coding-agent/test/graceful-terminate.test.ts', 'upstream test data: Chinese text'],
  ['third_party/pi-mono/packages/coding-agent/test/prompt-templates.test.ts', 'upstream test data: Chinese and Japanese text'],
  ['third_party/pi-mono/packages/coding-agent/test/tools.test.ts', 'upstream test data: Chinese text'],
  ['third_party/pi-mono/packages/coding-agent/test/truncate-to-width.test.ts', 'upstream test data: CJK width'],
  ['third_party/pi-mono/packages/tui/test/editor.test.ts', 'upstream test data: CJK editing'],
  ['third_party/pi-mono/packages/tui/test/input.test.ts', 'upstream test data: CJK input and width'],
  ['third_party/pi-mono/packages/tui/test/overlay-options.test.ts', 'upstream test data: CJK width'],
  ['third_party/pi-mono/packages/tui/test/stdin-buffer.test.ts', 'upstream test data: CJK input'],
  ['third_party/pi-mono/packages/tui/test/truncate-to-width.test.ts', 'upstream test data: CJK width'],
  ['third_party/pi-mono/packages/tui/test/word-navigation.test.ts', 'upstream test data: Chinese word navigation'],
  ['third_party/pi-mono/packages/tui/test/wrap-ansi.test.ts', 'upstream test data: CJK wrapping'],
]);

/** True when the path is allowed, either directly or through one of its directories. */
export function isAllowed(relativePath) {
  for (const [entry] of ALLOWED_FILES) {
    if (relativePath === entry) return true;
    if (entry.endsWith('/') && relativePath.startsWith(entry)) return true;
  }
  return false;
}

/** The Chinese hits of one file. */
export function findLanguageHits(relativePath, text) {
  if (isAllowed(relativePath)) return [];
  const hits = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (!CJK_PATTERN.test(line)) return;
    hits.push({ file: relativePath, line: index + 1, text: line.trim().slice(0, 200) });
  });
  return hits;
}

/** The files of the repository: tracked, plus untracked ones that are not ignored. */
function repositoryFiles(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const listed = `${run(['ls-files', '-z'])}${run(['ls-files', '-z', '--others', '--exclude-standard'])}`;
  return [...new Set(listed.split('\0').filter(Boolean))].sort();
}

/** The files of a directory tree, relative to that directory. */
function directoryFiles(directory) {
  const entries = execFileSync('find', [directory, '-type', 'f'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
  return entries
    .split('\n')
    .filter(Boolean)
    .map((file) => (file.startsWith(prefix) ? file.slice(prefix.length) : path.basename(file)));
}

/** The text of a file, or null when it is missing or binary. */
function readTextFile(absolute) {
  let buffer;
  try {
    if (!statSync(absolute).isFile()) return null;
    buffer = readFileSync(absolute);
  } catch {
    return null;
  }
  if (buffer.includes(0)) return null; // binary
  return buffer.toString('utf8');
}

/**
 * The source file a build output was copied from.
 *
 * The build copies the assets of the local runtime and the agent tree into
 * the output directory. Everything else in the output was produced by the
 * bundler and has no single source file.
 */
export function sourcePathOf(relativeOutputPath) {
  if (relativeOutputPath.startsWith('assets/agents/')) {
    return `packages/local-runtime-v2/assets/agents/${relativeOutputPath.slice('assets/agents/'.length)}`;
  }
  if (relativeOutputPath.startsWith('assets/')) {
    return `packages/local-runtime/assets/${relativeOutputPath.slice('assets/'.length)}`;
  }
  return null;
}

/** The runs of Chinese characters in a text. */
export function cjkSegments(text) {
  return text.match(CJK_SEGMENT_PATTERN) ?? [];
}

/**
 * The Chinese text that the allowed source files carry.
 *
 * A bundled file may contain the Chinese locale, so its Chinese runs have to
 * come from a source file that is allowed to carry Chinese.
 */
function allowedSegments(root, files) {
  const segments = new Set();
  for (const file of files) {
    if (!isAllowed(file)) continue;
    const text = readTextFile(path.join(root, file));
    if (text === null) continue;
    for (const segment of cjkSegments(text)) segments.add(segment);
  }
  return segments;
}

/**
 * The hits of a bundled file.
 *
 * The bundler inlines the sources, so the Chinese of the output is the Chinese
 * of the sources. Every run of Chinese characters in a bundled file has to
 * occur in an allowed source file; anything else is Chinese that entered the
 * product through a source the gate does not know about.
 */
function findBundleHits(relativeOutputPath, text, segments) {
  const hits = [];
  for (const segment of cjkSegments(text)) {
    if (segments.has(segment)) continue;
    hits.push({ file: relativeOutputPath, line: 0, text: segment });
  }
  return hits;
}

export function checkLanguage(root) {
  const hits = [];
  const files = repositoryFiles(root);
  for (const file of files) {
    const text = readTextFile(path.join(root, file));
    if (text === null) continue;
    hits.push(...findLanguageHits(file, text));
  }

  const buildOutput = path.join(root, 'dist');
  if (existsSync(buildOutput)) {
    const segments = allowedSegments(root, files);
    const known = new Set(files);
    for (const file of directoryFiles(buildOutput)) {
      const text = readTextFile(path.join(buildOutput, file));
      if (text === null) continue;
      const outputPath = `dist/${file}`;
      const source = sourcePathOf(file);
      if (source !== null && known.has(source)) {
        // a verbatim copy of a source file: the source scan is authoritative
        continue;
      }
      hits.push(...findBundleHits(outputPath, text, segments));
    }
  }
  return hits;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hits = checkLanguage(root);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
  } else if (hits.length > 0) {
    for (const hit of hits) process.stderr.write(`${hit.file}:${hit.line}: ${hit.text}\n`);
    process.stderr.write(
      `\nLanguage gate failed: ${hits.length} Chinese line(s) outside the files that may carry them.\n` +
        'Translate the text into English. The Chinese locale, the Chinese documents and the Chinese test data are listed in scripts/check-language.mjs.\n',
    );
  } else {
    process.stdout.write('Language gate passed: no Chinese outside the Chinese locale, the Chinese documents and the Chinese test data.\n');
  }
  if (hits.length > 0) process.exitCode = 1;
}
