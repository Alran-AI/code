/**
 * Diff guard: the anti-weakening layer of the CI Fixer.
 *
 * Every fix the agent proposes passes through this module before it can be
 * committed. The guard rejects changes that make a run green by disabling the
 * check instead of fixing the code: deleted test files, removed tests,
 * skip/only markers, softened assertions, lowered coverage or lint thresholds,
 * emptied test scripts, and edits to protected paths. It works on the unified
 * diff only, so it is fast, deterministic and easy to test.
 */

import { isDeniedPath } from './config.js';

export type DiffGuardViolationCode =
  | 'denied-path'
  | 'test-file-deleted'
  | 'test-removed'
  | 'test-weakened'
  | 'assertion-removed'
  | 'trivial-assertion'
  | 'coverage-threshold-lowered'
  | 'check-disabled';

export interface DiffGuardViolation {
  readonly code: DiffGuardViolationCode;
  readonly file: string;
  readonly line?: number;
  readonly detail: string;
}

export interface DiffGuardInput {
  readonly diff: string;
  readonly denyPaths: readonly string[];
  readonly forbidTestWeakening: boolean;
}

export interface DiffGuardResult {
  readonly ok: boolean;
  readonly violations: readonly DiffGuardViolation[];
}

interface DiffLine {
  readonly text: string;
  readonly line: number;
}

interface DiffHunk {
  readonly added: DiffLine[];
  readonly removed: DiffLine[];
}

interface DiffFile {
  readonly path: string;
  /** Path before the change; differs from `path` on renames. */
  readonly oldPath: string;
  deleted: boolean;
  readonly hunks: DiffHunk[];
}

const TEST_PATH =
  /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.go$|_test\.py$|_spec\.rb$|Test\.java$|_test\.exs$|Tests?\.swift$|\.test\.cs$/iu;

const SKIP_MARKER =
  /\.(?:skip|only)\s*\(|\b(?:xit|xdescribe|fdescribe|fit)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)|@Ignore\b|QSKIP\b|pytest\.skip\s*\(|skipTest\s*\(|@Test\s*\([^)]*enabled\s*=\s*false|\bskip\s*\(\s*\)/iu;

const TEST_DEFINITION =
  /(?:^|\s)(?:it|test|describe|context)\s*\(\s*['"`]([^'"`]+)['"`]|^\s*def\s+(test_\w+)|^\s*func\s+(Test\w+)|^\s*#\[test\]|^\s*\[(?:Fact|Theory)\]|^\s*@Test\b/ium;

const ASSERTION =
  /\bexpect\s*\(|\bassert(?:That|\w*)?\s*\(|\bassert\s+(?!=)|\bCHECK\s*\(|\bTEST_ASSERT\w*\b|\bshould\s*\.\s*(?:be|equal|contain|have|match)\s*\(/iu;

const TRIVIAL_ASSERTION =
  /\bexpect\s*\(\s*(?:true|false|1|0|null|undefined)\s*\)\s*\.\s*(?:toBe|toEqual|toBeTruthy|toBeFalsy|toBeDefined|toExist)\s*\(|\bassert\s*\(\s*(?:true|1)\s*\)/iu;

const THRESHOLD_KEY =
  /^((?:coverage|threshold|percent|fail[-_]?under|minimum|min|lines|branches|functions|statements)(?:[_-][A-Za-z0-9]+)*)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%?/iu;

const COVERAGE_FLAG = /--coverage\b|collectCoverage\s*[:=]\s*true|--collect-coverage/iu;

const CHECK_DISABLED =
  /continue-on-error\s*:\s*true|\bif\s*:\s*false\b|\|\|\s*true\b|;\s*true\s*$|\bset\s+\+e\b|\bexit\s+0\b|-DskipTests\b|maven\.test\.skip\s*=\s*true|skipTests\s*[:=]\s*true|--no-verify\b|\bnoVerify\b|(?:["'])?test(?:["'])?\s*:\s*["']\s*(?:echo|true|exit\s+0|:)|(?:["'])?test(?:["'])?\s*:\s*[""]/iu;

function testDefinitionName(line: string): string | undefined {
  for (const pattern of [
    /(?:it|test|describe|context)\s*\(\s*['"`]([^'"`]+)['"`]/u,
    /def\s+(test_\w+)/u,
    /func\s+(Test\w+)/u,
  ]) {
    const match = pattern.exec(line);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Parses a unified diff into per-file added/removed lines with numbers. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;
  let addedLine = 0;
  let removedLine = 0;

  const closeHunk = (): void => {
    if (current && currentHunk) current.hunks.push(currentHunk);
    currentHunk = undefined;
  };
  const closeFile = (): void => {
    closeHunk();
    current = undefined;
  };

  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      closeFile();
      const headerMatch = /diff --git a\/(.*) b\/(.*)/u.exec(rawLine);
      const oldPath = headerMatch?.[1] ?? rawLine.slice('diff --git '.length);
      const path = headerMatch?.[2] ?? oldPath;
      current = { path, oldPath, deleted: false, hunks: [] };
      files.push(current);
    } else if (rawLine.startsWith('deleted file mode')) {
      if (current) current.deleted = true;
    } else if (rawLine.startsWith('+++ ')) {
      // +++ b/path or +++ /dev/null; a /dev/null target means the file is gone.
      if (current && rawLine.trim() === '+++ /dev/null') current.deleted = true;
    } else if (rawLine.startsWith('@@')) {
      closeHunk();
      const hunk = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(rawLine);
      removedLine = hunk ? Number(hunk[1]) : 1;
      addedLine = hunk ? Number(hunk[2]) : 1;
      currentHunk = { added: [], removed: [] };
    } else if (current && currentHunk) {
      if (rawLine.startsWith('+')) {
        currentHunk.added.push({ text: rawLine.slice(1), line: addedLine });
        addedLine += 1;
      } else if (rawLine.startsWith('-')) {
        currentHunk.removed.push({ text: rawLine.slice(1), line: removedLine });
        removedLine += 1;
      } else if (rawLine.startsWith(' ')) {
        addedLine += 1;
        removedLine += 1;
      }
    }
  }
  closeFile();
  return files;
}

/** Runs every guard rule over a unified diff. */
export function guardFixDiff(input: DiffGuardInput): DiffGuardResult {
  const violations: DiffGuardViolation[] = [];
  const files = parseUnifiedDiff(input.diff);

  for (const file of files) {
    if (
      isDeniedPath(file.path, input.denyPaths) ||
      isDeniedPath(file.oldPath, input.denyPaths)
    ) {
      violations.push({
        code: 'denied-path',
        file: file.path,
        detail: `edits to ${file.path} are not allowed for the CI fix agent`,
      });
      continue;
    }
    if (!input.forbidTestWeakening) continue;

    if (file.deleted && TEST_PATH.test(file.path)) {
      violations.push({
        code: 'test-file-deleted',
        file: file.path,
        detail: 'deleting a test file is not a fix; restore it or fix the code under test',
      });
      continue;
    }

    const addedNames = new Set<string>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const name = testDefinitionName(entry.text);
        if (name) addedNames.add(name);
      }
    }

    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const marker = SKIP_MARKER.exec(entry.text)?.[0];
        if (marker) {
          violations.push({
            code: 'test-weakened',
            file: file.path,
            line: entry.line,
            detail: `adds a skip/only marker (${marker.trim()}); tests must run, not be avoided`,
          });
        }
        if (TRIVIAL_ASSERTION.test(entry.text)) {
          violations.push({
            code: 'trivial-assertion',
            file: file.path,
            line: entry.line,
            detail: 'adds an assertion that cannot fail; this weakens the test suite',
          });
        }
        if (CHECK_DISABLED.test(entry.text)) {
          violations.push({
            code: 'check-disabled',
            file: file.path,
            line: entry.line,
            detail: 'adds a pattern that disables or bypasses a check; CI must stay strict',
          });
        }
      }

      const removedAssertion = hunk.removed.some((entry) => ASSERTION.test(entry.text));
      const addedAssertion = hunk.added.some((entry) => ASSERTION.test(entry.text));
      if (removedAssertion && !addedAssertion && hunk.removed.length > 0) {
        const first = hunk.removed.find((entry) => ASSERTION.test(entry.text));
        violations.push({
          code: 'assertion-removed',
          file: file.path,
          line: first?.line,
          detail: 'removes an assertion without replacing it in the same hunk',
        });
      }
    }

    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        if (!TEST_DEFINITION.test(entry.text)) continue;
        const name = testDefinitionName(entry.text);
        if (name && addedNames.has(name)) continue;
        violations.push({
          code: 'test-removed',
          file: file.path,
          line: entry.line,
          detail: 'removes a test definition; a CI fix must keep every test running',
        });
      }
    }

    const removedThresholds = new Map<string, number>();
    const addedThresholds = new Map<string, number>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        const match = THRESHOLD_KEY.exec(entry.text.trim());
        if (match) removedThresholds.set(match[1].toLowerCase(), Number(match[2]));
      }
      for (const entry of hunk.added) {
        const match = THRESHOLD_KEY.exec(entry.text.trim());
        if (match) addedThresholds.set(match[1].toLowerCase(), Number(match[2]));
      }
    }
    for (const [key, addedValue] of addedThresholds) {
      const removedValue = removedThresholds.get(key);
      if (removedValue !== undefined && addedValue < removedValue) {
        violations.push({
          code: 'coverage-threshold-lowered',
          file: file.path,
          detail: `lowers the ${key} threshold from ${removedValue} to ${addedValue}`,
        });
      }
    }

    const removedCoverage = file.hunks.some((hunk) =>
      hunk.removed.some((entry) => COVERAGE_FLAG.test(entry.text)),
    );
    const addedCoverage = file.hunks.some((hunk) =>
      hunk.added.some((entry) => COVERAGE_FLAG.test(entry.text)),
    );
    if (removedCoverage && !addedCoverage) {
      violations.push({
        code: 'coverage-threshold-lowered',
        file: file.path,
        detail: 'drops coverage collection; the fix must keep the suite measured',
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
