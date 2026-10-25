import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAlranToolsArtifact, ALRAN_TOOLS_ARTIFACT } from '../scripts/lib/alran-tools-artifact.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('the vendored artifact yields the exact embedded production tool artifact', async () => {
  const extracted = await readAlranToolsArtifact(repoRoot);
  const built = readFileSync(new URL('../dist/embedded/alran-tools/cli.mjs', import.meta.url));
  assert.deepEqual(extracted.cli, built);
  assert.equal(createHash('sha256').update(built).digest('hex'), ALRAN_TOOLS_ARTIFACT.sha256);
  assert.equal(JSON.parse(extracted.manifest).auth.mode, 'shared-broker');
});

test('a modified vendored artifact is rejected before it can be accepted', async () => {
  const { writeFile, mkdtemp, cp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const staging = await mkdtemp(path.join(tmpdir(), 'alran-tools-'));
  await cp(path.join(repoRoot, ALRAN_TOOLS_ARTIFACT.dir), path.join(staging, ALRAN_TOOLS_ARTIFACT.dir), {
    recursive: true,
  });
  const cliPath = path.join(staging, ALRAN_TOOLS_ARTIFACT.dir, 'cli.mjs');
  const tampered = readFileSync(cliPath);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(cliPath, tampered);
  await assert.rejects(readAlranToolsArtifact(staging), /integrity mismatch/);
});

test('the built alran-tools CLI starts independently and exposes its commands', () => {
  const cli = fileURLToPath(new URL('../dist/alran-tools.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /alran-tools/);
});

test('the built image preview worker processes a synthetic PNG and exits cleanly', { timeout: 15000 }, async (t) => {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(new URL('../dist/image-preview-worker.js', import.meta.url), {
    workerData: {
      bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGP4n8LwnxLMMGrAqAGjBgwXAwCOqWIfmQV0zAAAAABJRU5ErkJggg==', 'base64'),
      mimeType: 'image/png',
      maxWidth: 960,
    },
  });
  // Allow normal Worker/WASM teardown after the reply. A message alone does
  // not prove a clean exit; force termination is only timeout/failure cleanup.
  t.after(() => worker.terminate());
  const preview = await new Promise((resolve, reject) => {
    let response;
    worker.once('message', (value) => { response = value; });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Preview worker exited with code ${code}`));
      else resolve(response);
    });
  });
  assert.equal(typeof preview, 'string');
  assert.deepEqual([...Buffer.from(preview, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
