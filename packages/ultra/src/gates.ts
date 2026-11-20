/**
 * Gate auto-detection for Ultra.
 *
 * The gate is what makes "done" mean something: the CLI runs these commands in
 * the packet worktree and the exit code decides. Detection reuses the CI
 * Fixer's project-command inference so Ultra and CI Fix never disagree about
 * what "test" means for the same repository; the result is shown in the plan
 * so the human can edit it before execution.
 */

import { detectProjectCommands } from '@alran/ci-fix';
import type { UltraGates } from './types.js';

export interface UltraGateSources {
  readonly packageJson?: { readonly scripts?: Record<string, string | undefined> };
  readonly pyproject?: string;
  readonly cargo?: string;
  readonly goMod?: string;
  readonly makefile?: string;
}

/** Returns the test/lint/build commands Ultra will use as full-suite gates. */
export function detectUltraGates(sources: UltraGateSources): UltraGates {
  const commands = detectProjectCommands(sources);
  return {
    test: [...commands.test],
    lint: [...commands.lint],
    build: [...commands.build],
  };
}
