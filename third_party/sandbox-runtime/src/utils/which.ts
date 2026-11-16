import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve, sep } from "node:path";

/** Find an executable without depending on an external which process and its start-up timeout. */
export function whichSync(
  bin: string,
  searchPath = process.env.PATH ?? "",
): string | null {
  if (!bin || bin.includes("\0")) return null;
  const windows = process.platform === "win32";
  const extensions =
    windows && !extname(bin)
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  const explicit =
    isAbsolute(bin) || bin.includes(sep) || (windows && bin.includes("/"));
  const candidates = explicit
    ? [bin]
    : searchPath.split(delimiter).map((dir) => join(dir, bin));
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const file = resolve(candidate + extension);
      try {
        if (!statSync(file).isFile()) continue;
        accessSync(file, windows ? constants.F_OK : constants.X_OK);
        return file;
      } catch {
        // Continue to the next PATH entry when a file is absent or inaccessible.
      }
    }
  }
  return null;
}
