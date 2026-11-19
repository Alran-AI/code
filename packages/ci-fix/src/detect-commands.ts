/**
 * Project command detection for the CI Fixer.
 *
 * `alran ci init` needs to know which command reproduces a red CI run. The
 * detection is deliberately conservative: it reads the well-known project
 * files (package.json, pyproject.toml, Cargo.toml, go.mod, Makefile) and maps
 * them to test, lint and build commands. First file wins per slot, so a
 * repository can never be probed with two different test commands.
 */

export interface ProjectCommands {
  readonly test: readonly string[];
  readonly lint: readonly string[];
  readonly build: readonly string[];
}

export interface ProjectCommandSources {
  /** Parsed package.json, when present. */
  readonly packageJson?: {
    readonly scripts?: Record<string, string | undefined>;
  };
  /** Raw pyproject.toml text, when present. */
  readonly pyproject?: string;
  /** Raw Cargo.toml text, when present. */
  readonly cargo?: string;
  /** Raw go.mod text, when present. */
  readonly goMod?: string;
  /** Raw Makefile text, when present. */
  readonly makefile?: string;
}

const NPM_TEST_SCRIPTS = ['test', 'test:ci', 'ci:test', 'test:all', 'test:unit', 'tests', 'spec'];
const NPM_LINT_SCRIPTS = ['lint', 'lint:ci', 'ci:lint', 'lint:all', 'eslint', 'lint:js'];
const NPM_BUILD_SCRIPTS = ['build', 'build:ci', 'ci:build', 'build:all', 'compile', 'dist'];

const MAKEFILE_TARGET = /^([A-Za-z0-9_.-]+)\s*:(?!=)/;

function firstScript(
  scripts: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = scripts[name];
    if (typeof value === 'string' && value.trim().length > 0) return name;
  }
  return undefined;
}

function npmCommands(scripts: Record<string, string | undefined>): ProjectCommands {
  const test = firstScript(scripts, NPM_TEST_SCRIPTS);
  const lint = firstScript(scripts, NPM_LINT_SCRIPTS);
  const build = firstScript(scripts, NPM_BUILD_SCRIPTS);
  return {
    test: test ? [`npm run ${test}`] : [],
    lint: lint ? [`npm run ${lint}`] : [],
    build: build ? [`npm run ${build}`] : [],
  };
}

function makefileCommands(makefile: string): ProjectCommands {
  const targets = new Set<string>();
  for (const line of makefile.split('\n')) {
    const match = MAKEFILE_TARGET.exec(line);
    if (match) targets.add(match[1]);
  }
  const pick = (...names: string[]): string | undefined => names.find((name) => targets.has(name));
  const test = pick('test', 'check');
  const lint = pick('lint', 'linters');
  const build = pick('build', 'all');
  return {
    test: test ? [`make ${test}`] : [],
    lint: lint ? [`make ${lint}`] : [],
    build: build ? [`make ${build}`] : [],
  };
}

function pyprojectCommands(pyproject: string): ProjectCommands {
  const test = /\[tool\.pytest|pytest\s*=/u.test(pyproject) ? ['pytest'] : [];
  const lint = /\[tool\.ruff|ruff\s*=/u.test(pyproject) ? ['ruff check .'] : [];
  const build = /\[build-system\]/u.test(pyproject) ? ['python -m build'] : [];
  return { test, lint, build };
}

function cargoCommands(cargo: string): ProjectCommands {
  void cargo;
  return {
    test: ['cargo test'],
    lint: ['cargo clippy -- -D warnings'],
    build: ['cargo build'],
  };
}

function goCommands(goMod: string): ProjectCommands {
  return {
    test: ['go test ./...'],
    lint: [],
    build: ['go build ./...'],
  };
}

/**
 * Infers the probe commands for a project. npm scripts win over Makefile
 * targets, Makefile wins over the language defaults; every gap is filled from
 * the next source, so a Python-only repo still gets `pytest`.
 */
export function detectProjectCommands(sources: ProjectCommandSources): ProjectCommands {
  const result: { test: string[]; lint: string[]; build: string[] } = {
    test: [],
    lint: [],
    build: [],
  };
  const fill = (slot: 'test' | 'lint' | 'build', values: readonly string[]): void => {
    if (result[slot].length === 0 && values.length > 0) {
      result[slot] = [...values];
    }
  };

  if (sources.packageJson?.scripts) {
    const npm = npmCommands(sources.packageJson.scripts);
    fill('test', npm.test);
    fill('lint', npm.lint);
    fill('build', npm.build);
  }
  if (sources.makefile) {
    const make = makefileCommands(sources.makefile);
    fill('test', make.test);
    fill('lint', make.lint);
    fill('build', make.build);
  }
  if (sources.pyproject) {
    const python = pyprojectCommands(sources.pyproject);
    fill('test', python.test);
    fill('lint', python.lint);
    fill('build', python.build);
  }
  if (sources.cargo) {
    const rust = cargoCommands(sources.cargo);
    fill('test', rust.test);
    fill('lint', rust.lint);
    fill('build', rust.build);
  }
  if (sources.goMod) {
    const go = goCommands(sources.goMod);
    fill('test', go.test);
    fill('lint', go.lint);
    fill('build', go.build);
  }
  return result;
}

/**
 * Extracts the command a CI failure actually ran from a failed log line such as
 * `npm test` or `##[error]Process completed with exit code 1`. Returns undefined
 * when no command can be named, in which case the configured test command is used.
 */
export function extractFailedCommand(logExcerpt: string): string | undefined {
  const lines = logExcerpt.split('\n').filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = /##\[(command|error)\]\s*(.+)/u.exec(line) ?? /^\$\s+(.+)/u.exec(line);
    if (match) {
      const candidate = match[2].trim();
      if (candidate.length > 0 && !/exit code|Error:/iu.test(candidate)) return candidate;
    }
  }
  return undefined;
}
