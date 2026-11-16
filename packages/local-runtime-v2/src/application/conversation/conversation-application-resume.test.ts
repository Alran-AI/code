import { describe, expect, it, vi } from 'vitest';

import { ConversationApplication } from './conversation-application.js';

type SessionStatus = 'idle' | 'started';

function application(options: {
  /** What the persisted session row says; it is a projection and can lag the turn. */
  readonly status: SessionStatus;
  /** The runtime's own answer to "is a turn running?"; undefined when no inspection is wired. */
  readonly activeTurn?: { readonly turnId: string } | null;
}) {
  const resume = vi.fn(() => (async function* frames() {})());
  const dispatchQueue = vi.fn(async () => ({ status: 'started' }));
  const instance = new ConversationApplication({
    stream: { resume },
    sessionReader: {
      find: async () => ({ agentName: 'agent', status: options.status }),
    },
    turn: { dispatchQueue },
    ...(options.activeTurn === undefined
      ? {}
      : {
          turnInspection: {
            activeTurn: async () => options.activeTurn ?? undefined,
          },
        }),
  } as never);
  const open = (request: Record<string, unknown> = {}) =>
    instance.resumeSession({} as never, { id: 'session-1', ...request } as never);
  return { open, resume, dispatchQueue };
}

describe('resuming a session stream', () => {
  it('follows the live turn when one is running but the stored status still reads idle', async () => {
    const { open, resume } = application({ status: 'idle', activeTurn: { turnId: 'turn-1' } });

    await open({ afterMsgId: 'msg-1' });

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ waitForTerminal: true }));
  });

  it('does not wait for a terminal event that will never come when no turn is running', async () => {
    const { open, resume } = application({ status: 'started', activeTurn: null });

    await open({ afterMsgId: 'msg-1' });

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ waitForTerminal: false }));
  });

  it('falls back to the stored status where the runtime cannot be asked', async () => {
    const started = application({ status: 'started' });
    const idle = application({ status: 'idle' });

    await started.open({ afterMsgId: 'msg-1' });
    await idle.open({ afterMsgId: 'msg-1' });

    expect(started.resume).toHaveBeenCalledWith(expect.objectContaining({ waitForTerminal: true }));
    expect(idle.resume).toHaveBeenCalledWith(expect.objectContaining({ waitForTerminal: false }));
  });

  it('always follows the turn that draining the queue starts', async () => {
    const { open, resume, dispatchQueue } = application({ status: 'idle', activeTurn: null });

    await open({ drainQueued: true });

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ waitForTerminal: true }));
    expect(dispatchQueue).toHaveBeenCalledWith('session-1');
  });
});
