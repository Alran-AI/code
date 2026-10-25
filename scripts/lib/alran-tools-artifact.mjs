import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The embedded `alran-tools` CLI.
 *
 * The tool is vendored under `third_party/alran-tools` instead of being
 * downloaded from a published npm archive at build time. Two reasons:
 *
 *   - The embedded bytes are a build input, and the build must not depend on a
 *     registry package that the fork itself publishes. A source build would
 *     otherwise need the fork's own first release to exist before it can build.
 *   - The CLI and the in-repo host share a runtime contract: the environment
 *     variables the CLI reads, the authentication lease socket and capability
 *     file names, the client id, and the platform base URLs. The vendored copy
 *     is the rebranded one, so both sides agree.
 *
 * The bytes are pinned by hash here and by the resource manifest next to them.
 */
export const ALRAN_TOOLS_ARTIFACT = Object.freeze({
  dir: 'third_party/alran-tools',
  version: '0.0.4',
  packageName: '@alran/alran-tools',
  sha256: 'b9c3f9d0f3c6fca314ecee514c2a0a23c280281e4ded743994149b1ddab57499',
});

const MANIFEST_FIELDS = ['version', 'buildEnv', 'entry', 'packageName'];

/**
 * Read and verify the vendored artifact.
 *
 * The hash of the CLI is checked before the manifest is trusted, so a tampered
 * file can never select the entry point or the package identity.
 */
export async function readAlranToolsArtifact(root) {
  const dir = path.join(root, ALRAN_TOOLS_ARTIFACT.dir);
  const cli = await readFile(path.join(dir, 'cli.mjs'));
  if (createHash('sha256').update(cli).digest('hex') !== ALRAN_TOOLS_ARTIFACT.sha256)
    throw new Error('Vendored alran-tools artifact integrity mismatch.');
  const manifestBytes = await readFile(path.join(dir, 'manifest.json'));
  const notices = await readFile(path.join(dir, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  for (const field of MANIFEST_FIELDS) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0)
      throw new Error(`Vendored alran-tools manifest is missing ${field}.`);
  }
  if (
    manifest.version !== ALRAN_TOOLS_ARTIFACT.version ||
    manifest.buildEnv !== 'prod' ||
    manifest.entry !== 'cli.mjs' ||
    manifest.packageName !== ALRAN_TOOLS_ARTIFACT.packageName
  )
    throw new Error('Vendored alran-tools manifest or entry integrity mismatch.');
  return { cli, manifest: manifestBytes, notices };
}

/** Copy the vendored artifact into the build output. */
export async function copyAlranToolsArtifact(root, outdir) {
  const artifact = await readAlranToolsArtifact(root);
  const destination = path.join(outdir, 'embedded', 'alran-tools');
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'cli.mjs'), artifact.cli);
  await writeFile(path.join(destination, 'manifest.json'), artifact.manifest);
  await writeFile(path.join(outdir, 'ALRAN_TOOLS_NOTICES.md'), artifact.notices);
}
