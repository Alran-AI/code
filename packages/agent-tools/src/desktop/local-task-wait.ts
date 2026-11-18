import { bindTool, type ToolImpl, type ToolResult } from '@alran/agent-core/tools';

import { LocalTaskWaitToolDef, type LocalTaskWaitToolInput } from './builtin-defs.js';
import type { LocalRuntimeToolContext, LocalTaskControlAdapter } from './types.js';

const DEFAULT_WAIT_MS = 30_000;

/**
 * Parks the turn on the same waiter registry that wakes the conversation when
 * a background task commits a terminal state. Waiting never stops a task and
 * never suppresses the ordinary completion delivery.
 */
@bindTool(LocalTaskWaitToolDef)
export class LocalTaskWaitTool
  implements ToolImpl<typeof LocalTaskWaitToolDef.schema, LocalRuntimeToolContext>
{
  constructor(private readonly adapter: LocalTaskControlAdapter) {}

  async execute(
    ctx: LocalRuntimeToolContext,
    input: LocalTaskWaitToolInput,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (signal?.aborted) throw new Error('Operation aborted');
    if (!this.adapter.waitForTasks) {
      const text =
        '<task_error>This runtime does not support task_wait; use task_output with wait_ms instead.</task_error>';
      return {
        tool_name: LocalTaskWaitToolDef.name,
        text,
        content: [{ type: 'text', text }],
        isError: true,
      };
    }

    const result = await this.adapter.waitForTasks(ctx, {
      ...(input.task_ids ? { taskIds: input.task_ids } : {}),
      waitMs: input.wait_ms ?? DEFAULT_WAIT_MS,
      ...(signal ? { signal } : {}),
    });
    const lines = result.tasks.map(
      (task) =>
        `  <task task_id="${escapeXmlAttribute(task.task_id)}" status="${task.status}"${task.kind ? ` kind="${escapeXmlAttribute(task.kind)}"` : ''}${task.description ? ` description="${escapeXmlAttribute(task.description)}"` : ''}/>`,
    );
    const clampedHint = result.wait_ms_clamped
      ? 'Your wait_ms exceeded 600000 ms and was capped at 600000 ms. '
      : '';
    const timeoutHint = result.timedOut
      ? 'The wait limit was reached; the tasks are still running and their completion will resume this conversation. '
      : '';
    const text = [
      `<task_wait timed_out="${result.timedOut}" wait_ms="${result.effective_wait_ms}">`,
      ...lines,
      `${clampedHint}${timeoutHint}Use task_output with a task_id to read the completed result.`,
      '</task_wait>',
    ].join('\n');

    return {
      tool_name: LocalTaskWaitToolDef.name,
      text,
      content: [{ type: 'text', text }],
      details: {
        ...result,
        task_ids: result.tasks.map((task) => task.task_id),
      },
    };
  }
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
