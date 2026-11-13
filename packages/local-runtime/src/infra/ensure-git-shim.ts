/**
 * Seed the commit-attribution `git` shim into `<dataDir>/shims/git-attribution/`.
 *
 * WHY A SHIM
 * ----------
 * A system reminder asks the model to end every commit message with
 * `Co-Authored-By: Alran Code using <model> <noreply@alran.dev>`. A reminder is a request, not a
 * guarantee, and rewriting the command text cannot be one either (`git -C x commit`, an alias, a script
 * the agent just wrote). The shell resolves `git` through PATH whatever the shape of the command, so a
 * shim at the front of the agent's PATH is reached in every case — the same argument as for the
 * recoverable-delete `rm` shim (see `ensure-rm-shim.ts`).
 *
 * WHAT IT DOES
 * ------------
 * It runs the real `git` unchanged, except for `git commit` (also through an alias that expands to it)
 * when the host set `ALRAN_COMMIT_TRAILER` for this call: then it adds
 * `--trailer "$ALRAN_COMMIT_TRAILER"`, which git merges into the message however the message was given
 * (`-m`, `-F`, `-C`, an editor). `trailer.Co-Authored-By.ifexists=addIfDifferent` makes the line appear
 * once even when the model already wrote it. A git older than 2.32 has no `commit --trailer`: the shim
 * runs it unchanged rather than fail the commit.
 *
 * The variable is set per call by the host from the turn's model and the user's `attribution.commits`
 * setting (see `resolveAgentBashEnvPolicy`); without it the shim is a pass-through.
 *
 * Its directory is its own subdirectory of `<dataDir>/shims` and not `<dataDir>/shims` itself: the
 * `nativeDelete` setting removes that directory from PATH (to get the native `rm` back), which must not
 * take the attribution with it. It is injected into the agent's bash only, never a user-facing shell.
 *
 * Windows is skipped, like the `rm` shim: there is no PATH shim for a PowerShell session. The reminder
 * still applies there.
 *
 * Idempotent: only rewrites when the on-disk content differs.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { seedFileIfChanged } from './seed-file.js';

export const GIT_SHIM_CONTENT = `#!/bin/bash
# Managed by Alran Code. Do not edit.
#
# Commit-attribution shim: runs the real git, and adds the host's Co-Authored-By trailer to
# \`git commit\` when ALRAN_COMMIT_TRAILER is set. Resolves ahead of git on the agent's PATH only.
# (No \`set -u\`: an empty array must expand to nothing on the bash 3.2 that macOS ships.)

# This shim's directory, and a PATH without it. The real git is looked up in that PATH and runs with it:
# another \`git\` wrapper on the machine (a low-priority dispatcher, a version manager's shim) that finds
# "the real git" by searching PATH would otherwise find this shim again, and the two would call each
# other for ever. (-ef compares inodes, so a differently spelled or symlinked entry is still this one.)
self="\${BASH_SOURCE[0]}"
self_dir="\${self%/*}"
clean=()
# The extra ":" keeps a trailing empty entry (the current directory) from being dropped by read.
IFS=':' read -r -a path_entries <<< "\${PATH:-}:"
for entry in "\${path_entries[@]}"; do
  if [ -n "$entry" ] && [ "$entry" -ef "$self_dir" ]; then continue; fi
  clean+=("$entry")
done
clean_path=""
if [ "\${#clean[@]}" -gt 0 ]; then
  printf -v clean_path '%s:' "\${clean[@]}"
  clean_path="\${clean_path%:}"
fi

real=""
for entry in "\${clean[@]}"; do
  [ -n "$entry" ] || continue
  candidate="$entry/git"
  [ -f "$candidate" ] && [ -x "$candidate" ] || continue
  [ "$candidate" -ef "$self" ] && continue
  real="$candidate"
  break
done
if [ -z "$real" ]; then
  echo "git: command not found" >&2
  exit 127
fi

trailer="\${ALRAN_COMMIT_TRAILER:-}"
case "$trailer" in
  *$'\\n'*|*$'\\r'*) trailer="" ;;
esac
if [ -z "$trailer" ]; then
  PATH="$clean_path" exec "$real" "$@"
fi

# The subcommand: the first argument that is not one of git's global options.
args=("$@")
count=\${#args[@]}
index=0
sub=""
sub_index=-1
while [ "$index" -lt "$count" ]; do
  current="\${args[$index]}"
  case "$current" in
    -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--attr-source)
      index=$((index + 2))
      ;;
    -*)
      index=$((index + 1))
      ;;
    *)
      sub="$current"
      sub_index=$index
      break
      ;;
  esac
done

is_commit=false
if [ "$sub" = "commit" ]; then
  is_commit=true
elif [ -n "$sub" ]; then
  # An alias that expands to a commit (\`git ci\`), looked up with the same global options.
  alias_value="$(PATH="$clean_path" "$real" "\${args[@]:0:$sub_index}" config --get "alias.$sub" 2>/dev/null || true)"
  case "$alias_value" in
    '!'*) ;;
    *) [ "\${alias_value%% *}" = "commit" ] && is_commit=true ;;
  esac
fi

if [ "$is_commit" = true ]; then
  version_line="$(PATH="$clean_path" "$real" --version 2>/dev/null || true)"
  version="\${version_line#git version }"
  major="\${version%%.*}"
  rest="\${version#*.}"
  minor="\${rest%%.*}"
  case "$major$minor" in
    ''|*[!0-9]*) ;;
    *)
      # \`git commit --trailer\` exists from git 2.32.
      if [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 32 ]; }; then
        PATH="$clean_path" exec "$real" -c "trailer.Co-Authored-By.ifexists=addIfDifferent" \\
          "\${args[@]:0:$((sub_index + 1))}" --trailer "$trailer" "\${args[@]:$((sub_index + 1))}"
      fi
      ;;
  esac
fi
PATH="$clean_path" exec "$real" "$@"
`;

/** Directory injected at the front of the agent's PATH for the git shim. */
export function resolveGitShimDir(dataDir: string): string {
  return path.join(dataDir, 'shims', 'git-attribution');
}

/**
 * Seed the shim. Returns the directory to prepend to PATH, or `undefined` when the platform has no
 * PATH-resolvable shim to put in front of `git`.
 */
export function ensureGitShim(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === 'win32') return undefined;
  const dir = resolveGitShimDir(dataDir);
  mkdirSync(dir, { recursive: true });
  seedFileIfChanged(path.join(dir, 'git'), GIT_SHIM_CONTENT, 0o755);
  return dir;
}
