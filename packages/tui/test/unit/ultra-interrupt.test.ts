/**
 * Ctrl+C has to pause a run, not kill the process.
 *
 * Without a handler the terminal's SIGINT ends the CLI outright: the run stays
 * `running` in its state file with nobody behind it, and `resume` refuses a
 * running run — so the work is stranded until somebody edits the state by
 * hand. The handler turns the signal into a stop request that the scheduler
 * picks up at its next safe point.
 *
 * The handler is tested by capturing it: the signal is never really raised,
 * because a test that killed its own runner would not be a test.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunStore } from '@alran/ultra';
import { installInterruptHandler } from '../../src/cli/ultra-command.js';

const dirs: string[] = [];

function storeFor(): RunStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-interrupt-'));
  dirs.push(dir);
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: 'run-i',
    goal: 'the goal',
    budgetUsd: 2,
  });
  store.setPackets([{ id: 'p1', title: 'one' }]);
  store.transition('running');
  return store;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Captures the handler the code installs, without really raising a signal. */
function captureHandler(): {
  readonly handler: (signal: NodeJS.Signals) => void;
  readonly restore: () => void;
} {
  const handlers: ((signal: NodeJS.Signals) => void)[] = [];
  const original = process.on.bind(process);
  const spy = vi.spyOn(process, 'on').mockImplementation(((
    event: string | symbol,
    listener: (...args: never[]) => void,
  ) => {
    if (event === 'SIGINT' || event === 'SIGTERM') {
      handlers.push(listener as (signal: NodeJS.Signals) => void);
    }
    return original(event as never, listener as never);
  }) as never);
  return {
    handler: (signal) => {
      const found = handlers[0];
      if (!found) throw new Error('no interrupt handler was installed');
      found(signal);
    },
    restore: () => spy.mockRestore(),
  };
}

describe('the interrupt handler', () => {
  it('turns the first interrupt into a stop request', () => {
    const store = storeFor();
    const chunks: string[] = [];
    const captured = captureHandler();
    const release = installInterruptHandler({ store, write: (text) => chunks.push(text) });
    try {
      captured.handler('SIGINT');
    } finally {
      release();
      captured.restore();
    }

    const request = JSON.parse(readFileSync(store.paths.control, 'utf8')) as { request: string };
    expect(request.request).toBe('pause');
    expect(chunks.join('')).toMatch(/next safe point/iu);
    // The run is still running: the scheduler stops it, not the signal.
    expect(store.state.status).toBe('running');
  });

  it('leaves the run resumable when the second interrupt asks to leave now', () => {
    const store = storeFor();
    const chunks: string[] = [];
    const captured = captureHandler();
    const raised: NodeJS.Signals[] = [];
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal: NodeJS.Signals) => {
      raised.push(signal);
      return true;
    }) as never);
    const release = installInterruptHandler({ store, write: (text) => chunks.push(text) });
    try {
      captured.handler('SIGINT');
      captured.handler('SIGINT');
    } finally {
      release();
      captured.restore();
    }

    // The process is about to die, so the run must not be left saying
    // `running`: nobody would be behind it, and such a run cannot be resumed.
    expect(store.state.status).toBe('paused');
    // The handler steps aside and lets the host deal with the signal.
    expect(raised).toEqual(['SIGINT']);
    expect(chunks.join('')).toMatch(/again/iu);
  });

  it('says so when the stop request cannot be written', () => {
    const store = storeFor();
    const chunks: string[] = [];
    const captured = captureHandler();
    // A store whose run directory does not exist cannot hold a request.
    const broken = {
      state: store.state,
      paths: { ...store.paths, control: '/nonexistent/ultra/control.json' },
    } as unknown as RunStore;
    const release = installInterruptHandler({
      store: broken as unknown as RunStore,
      write: (text) => chunks.push(text),
    });
    try {
      captured.handler('SIGINT');
    } finally {
      release();
      captured.restore();
    }

    expect(chunks.join('')).toMatch(/could not be written/iu);
    expect(chunks.join('')).not.toMatch(/next safe point/iu);
  });
});
