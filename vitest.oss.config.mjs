import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExtraction } from "./scripts/lib/release-metadata.mjs";
import { packageExportEntries } from "./scripts/lib/package-exports.mjs";
import { allSuiteFiles } from "./scripts/lib/vitest-suites.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const { packageRoots } = readExtraction(root);
const alias = packageExportEntries(root, packageRoots).map(
  ({ specifier, file }) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: path.join(root, file),
  }),
);
// highlight.js 11 dropped the `./lib/index.js` exports entry. The vendored
// pi-mono source still uses that specifier (see its local ambient declaration),
// so resolve it to the package entry, matching the CLI build.
alias.push({
  find: /^highlight\.js\/lib\/index\.js$/,
  replacement: createRequire(import.meta.url).resolve("highlight.js"),
});
export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: allSuiteFiles(root),
  },
});
