import { bindTool, type ToolImpl, type ToolResult } from '@alran/agent-core/tools';

import { LocalTaskSpawnToolDef, type LocalTaskSpawnToolInput } from './builtin-defs.js';
import type { LocalRuntimeToolContext, LocalTaskAdapter } from './types.js';

/**
 * One call, several independently tracked background child Sessions. The
 * runtime task service owns admission and terminal wake-up for each entry, so
 * the group adds no second delegation state machine.
 */
@bindTool(LocalTaskSpawnToolDef)
export class LocalTaskSpawnTool
  implements ToolImpl<typeof LocalTaskSpawnToolDef.schema, LocalRuntimeToolContext>
{
  constructor(private readonly adapter: LocalTaskAdapter) {}

  async execute(
    ctx: LocalRuntimeToolContext,
    input: LocalTaskSpawnToolInput,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (signal?.aborted) throw new Error('Operation aborted');

    const started = await Promise.all(
      input.agents.map(async (agent) => {
        const result = await this.adapter.startBackground(
          ctx,
          {
            description: agent.description,
            prompt: agent.prompt,
            agent_name: agent.agent_name,
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.effort ? { effort: agent.effort } : {}),
            run_in_background: true,
          },
          signal,
        );
        return { agent, result };
      }),
    );

    const tasks = started.map(({ agent, result }) => ({
      task_id: result.taskId,
      status: result.status,
      agent_name: agent.agent_name,
      description: agent.description,
      ...(result.subSessionId ? { session_id: result.subSessionId } : {}),
      ...(result.errorMessage ? { error_message: result.errorMessage } : {}),
    }));
    const taskIds = tasks.flatMap((task) => (task.task_id ? [task.task_id] : []));
    const startedCount = tasks.filter((task) => task.status === 'started').length;
    const lines = tasks.map(
      (task) =>
        `  <task${task.task_id ? ` task_id="${escapeXmlAttribute(task.task_id)}"` : ''} status="${task.status}" agent_name="${escapeXmlAttribute(task.agent_name)}" description="${escapeXmlAttribute(task.description)}"${task.session_id ? ` session_id="${escapeXmlAttribute(task.session_id)}"` : ''}${task.error_message ? ` error="${escapeXmlAttribute(task.error_message)}"` : ''}/>`,
    );
    const text = [
      `<task_spawn label="${escapeXmlAttribute(input.label)}" started="${startedCount}" total="${tasks.length}">`,
      ...lines,
      `Started ${startedCount} of ${tasks.length} background Agents. Report the start to the user and end your turn; each completion will resume this conversation automatically. Use task_wait only if you deliberately want to stay in this turn until they settle, or task_output to read a result early.`,
      '</task_spawn>',
    ].join('\n');

    return {
      tool_name: LocalTaskSpawnToolDef.name,
      text,
      content: [{ type: 'text', text }],
      details: {
        label: input.label,
        started: startedCount,
        total: tasks.length,
        task_ids: taskIds,
        tasks,
      },
      ...(startedCount === 0 ? { isError: true } : {}),
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
