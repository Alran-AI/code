export const TUI_BUNDLE_CHUNKS_DIRECTORY = "chunks";
const TUI_BUNDLE_STABLE_MODULE_URL_IDENTIFIER = "__alran_tuiPackageEntryUrl";

export function createTuiBundleModuleLocationConfig() {
  const banner =
    'import { createRequire as __alran_cR } from "module"; ' +
    'import { basename as __alran_basename, dirname as __alran_dirname, join as __alran_join } from "path"; ' +
    'import { fileURLToPath as __alran_fileURLToPath, pathToFileURL as __alran_pathToFileURL } from "url"; ' +
    "const __alran_tuiCurrentModuleDir = __alran_dirname(__alran_fileURLToPath(import.meta.url)); " +
    `const __alran_tuiPackageRoot = __alran_basename(__alran_tuiCurrentModuleDir) === ${JSON.stringify(TUI_BUNDLE_CHUNKS_DIRECTORY)} ? __alran_dirname(__alran_tuiCurrentModuleDir) : __alran_tuiCurrentModuleDir; ` +
    `const ${TUI_BUNDLE_STABLE_MODULE_URL_IDENTIFIER} = __alran_pathToFileURL(__alran_join(__alran_tuiPackageRoot, "cli.js")).href; ` +
    `const require = __alran_cR(${TUI_BUNDLE_STABLE_MODULE_URL_IDENTIFIER}); ` +
    "const __dirname = __alran_tuiPackageRoot;";
  return {
    banner,
    define: Object.freeze({
      "import.meta.url": TUI_BUNDLE_STABLE_MODULE_URL_IDENTIFIER,
    }),
  };
}
