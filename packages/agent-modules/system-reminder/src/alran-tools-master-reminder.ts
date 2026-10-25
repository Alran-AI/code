const ALRAN_TOOLS_MODEL_PREFIX = 'Alran-M2.7';

const ALRAN_TOOLS_MASTER_REMINDER = [
  '<alran-tools-master-reminder>',
  'For multimodal generation and understanding, including images/photos, video, audio, music, and documents, load the alran-tools-master skill and use alran-tools through Bash.',
  'Discover the relevant tools before concluding that a multimodal capability is unavailable.',
  '</alran-tools-master-reminder>',
].join('\n');

export function withAlranToolsMasterReminder(input: {
  reminderText: string | undefined;
  modelID: string | undefined;
  enabled: boolean;
}): string | undefined {
  if (!input.enabled || !input.modelID?.startsWith(ALRAN_TOOLS_MODEL_PREFIX)) {
    return input.reminderText;
  }

  const existing = unwrapSystemReminder(input.reminderText);
  const body = existing
    ? `${existing}\n\n${ALRAN_TOOLS_MASTER_REMINDER}`
    : ALRAN_TOOLS_MASTER_REMINDER;
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

function unwrapSystemReminder(text: string | undefined): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^<system-reminder>\s*/u, '')
    .replace(/\s*<\/system-reminder>$/u, '')
    .trim();
}
