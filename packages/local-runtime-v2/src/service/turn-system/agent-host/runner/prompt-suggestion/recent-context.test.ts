import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { buildRecentConversationPrompt, latestUserText } from './recent-context.js';

const reply = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'test',
  model: 'test',
  usage: {
    input: 20,
    output: 60,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 80,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  timestamp: 1,
});

describe('recent conversation rendering', () => {
  const user = (content: string) => ({ role: 'user' as const, content, timestamp: 0 });
  const answered = (text: string) => reply([{ type: 'text', text }]);
  const instruction = 'INSTRUCTION';

  it('keeps only the last three turns and groups steering messages into their turn', () => {
    const messages = [
      user('round one'),
      answered('reply one'),
      user('round two'),
      answered('reply two'),
      user('round three'),
      reply([{ type: 'toolCall', id: 'c', name: 'bash', arguments: {} }], 'toolUse'),
      user('interjection: by the way, check the logs'),
      answered('reply three'),
      user('round four'),
    ];
    const prompt = buildRecentConversationPrompt(messages, answered('reply four'), instruction);
    expect(prompt).not.toContain('round one');
    expect(prompt).toContain(
      '<turn>\n<user>round three</user>\n<user>interjection: by the way, check the logs</user>\n<assistant>reply three</assistant>\n</turn>',
    );
    expect(prompt).toContain('<user>round four</user>\n<assistant>reply four</assistant>');
    expect(prompt.match(/<turn>/g)).toHaveLength(3);
  });

  it('keeps the head of long user text and the tail of long replies', () => {
    const prompt = buildRecentConversationPrompt(
      [user(`requirement start${'A'.repeat(5000)}requirement end`)],
      answered(`reply start${'B'.repeat(5000)}next step: run the tests`),
      instruction,
    );
    expect(prompt).toContain('requirement start');
    expect(prompt).toContain('next step: run the tests');
    expect(prompt).toContain('characters omitted]');
    expect(prompt.length).toBeLessThan(5_000);
  });

  it('reduces a selection-context block to the user comments', () => {
    const text = `<user-provided-context>\n# Added chat context\n${'boilerplate '.repeat(400)}\nUser comment (requested change):\nchange this to a synchronous call\n\nQuoted excerpt: "..."\n</user-provided-context>\n\ntake a look`;
    const prompt = buildRecentConversationPrompt([user(text)], answered('sure'), instruction);
    expect(prompt).toContain('[Comments on quoted content] (1) change this to a synchronous call');
    expect(prompt).not.toContain('boilerplate');
    expect(latestUserText([user(text)])).toContain('take a look');
  });

  it('keeps only the readable Q/A of a questionnaire answer', () => {
    const answer = `<questionnaire-response>\n  <requestId>ask_1</requestId>\n  <answers><answer><stepId>list_target</stepId></answer></answers>\n</questionnaire-response>\n\nQ: Which list do you want to run?\nA: List the repositories/folders in the current workspace`;
    const prompt = buildRecentConversationPrompt(
      [
        user('run list'),
        reply([{ type: 'toolCall', id: 'q', name: 'ask_user', arguments: {} }], 'toolUse'),
        user(answer),
      ],
      answered('the current workspace has 13 folders'),
      instruction,
    );
    expect(prompt).toContain(
      '<user>Q: Which list do you want to run?\nA: List the repositories/folders in the current workspace</user>',
    );
    expect(prompt).not.toContain('requestId');
    expect(prompt).not.toContain('questionnaire-response');
  });

  it('never throws on unexpected message shapes', () => {
    const messages = [
      null,
      42,
      { role: 'system', content: 'x' },
      { role: 'user', content: [{ type: 'image' }] },
      user('the real question'),
    ];
    expect(() =>
      buildRecentConversationPrompt(messages, answered('reply'), instruction),
    ).not.toThrow();
    expect(buildRecentConversationPrompt(messages, answered('reply'), instruction)).toContain(
      '<user>the real question</user>',
    );
  });
});
