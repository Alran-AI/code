import { describe, expect, it } from "vitest";
import { detectProjectCommands, extractFailedCommand } from "../../src/detect-commands.js";

describe("project command detection", () => {
  it("reads npm scripts and prefers the CI variants", () => {
    const commands = detectProjectCommands({
      packageJson: {
        scripts: {
          "test:ci": "vitest run",
          lint: "eslint .",
          build: "tsc -p .",
        },
      },
    });
    expect(commands.test).toEqual(["npm run test:ci"]);
    expect(commands.lint).toEqual(["npm run lint"]);
    expect(commands.build).toEqual(["npm run build"]);
  });

  it("falls back to plain test/lint/build script names", () => {
    const commands = detectProjectCommands({
      packageJson: { scripts: { test: "jest", build: "vite build" } },
    });
    expect(commands.test).toEqual(["npm run test"]);
    expect(commands.lint).toEqual([]);
    expect(commands.build).toEqual(["npm run build"]);
  });

  it("detects pytest, ruff and the Python build backend", () => {
    const commands = detectProjectCommands({
      pyproject: "[tool.pytest.ini_options]\n[tool.ruff]\n[build-system]\n",
    });
    expect(commands.test).toEqual(["pytest"]);
    expect(commands.lint).toEqual(["ruff check ."]);
    expect(commands.build).toEqual(["python -m build"]);
  });

  it("detects cargo and go commands", () => {
    expect(detectProjectCommands({ cargo: "[package]\n" }).test).toEqual(["cargo test"]);
    expect(detectProjectCommands({ cargo: "[package]\n" }).lint).toEqual([
      "cargo clippy -- -D warnings",
    ]);
    expect(detectProjectCommands({ goMod: "module example.test\n" }).test).toEqual(["go test ./..."]);
    expect(detectProjectCommands({ goMod: "module example.test\n" }).build).toEqual([
      "go build ./...",
    ]);
  });

  it("detects Makefile targets", () => {
    const commands = detectProjectCommands({
      makefile: "all: build\nbuild:\n\tcargo build\ntest:\n\tcargo test\nlint:\n\tcargo clippy\n",
    });
    expect(commands.test).toEqual(["make test"]);
    expect(commands.lint).toEqual(["make lint"]);
    expect(commands.build).toEqual(["make build"]);
  });

  it("fills gaps from the next source instead of overwriting", () => {
    const commands = detectProjectCommands({
      packageJson: { scripts: { test: "jest" } },
      makefile: "lint:\n\tcargo clippy\n",
    });
    expect(commands.test).toEqual(["npm run test"]);
    expect(commands.lint).toEqual(["make lint"]);
  });

  it("returns empty slots for an empty project", () => {
    const commands = detectProjectCommands({});
    expect(commands.test).toEqual([]);
    expect(commands.lint).toEqual([]);
    expect(commands.build).toEqual([]);
  });
});

describe("failed command extraction", () => {
  it("reads the last command marker from a failed log", () => {
    const command = extractFailedCommand(
      "Run npm test\n##[command]npm test\nError: process exited with code 1",
    );
    expect(command).toBe("npm test");
  });

  it("ignores exit-code noise and returns undefined on plain logs", () => {
    expect(extractFailedCommand("##[error]Process completed with exit code 1")).toBeUndefined();
    expect(extractFailedCommand("")).toBeUndefined();
  });
});
