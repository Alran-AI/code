export type AlranUpdatePhase =
  | 'checking'
  | 'downloading'
  | 'staging'
  | 'installing'
  | 'validating'
  | 'activating'
  | 'completed';

export interface AlranUpdatePhaseEvent {
  readonly phase: AlranUpdatePhase;
  readonly cancellable: boolean;
}

export interface AlranUpdateOperationOptions {
  readonly signal?: AbortSignal;
  readonly onOutput?: (chunk: string) => void;
  readonly onPhase?: (event: AlranUpdatePhaseEvent) => void;
}

export class AlranUpdateCancelledError extends Error {
  constructor(message = 'Alran update cancelled; the previous installation remains active.') {
    super(message);
    this.name = 'AlranUpdateCancelledError';
  }
}

export class AlranUpdateAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlranUpdateAdmissionError';
  }
}

export function throwIfAlranUpdateCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AlranUpdateCancelledError();
}

export function reportAlranUpdatePhase(
  options: Pick<AlranUpdateOperationOptions, 'onPhase'>,
  phase: AlranUpdatePhase,
  cancellable: boolean,
): void {
  try {
    options.onPhase?.({ phase, cancellable });
  } catch {
    // Presentation observers must not change update safety or outcome.
  }
}

export function isAlranUpdateCancelledError(error: unknown): error is AlranUpdateCancelledError {
  return error instanceof AlranUpdateCancelledError;
}

export function isAlranUpdateAdmissionError(error: unknown): error is AlranUpdateAdmissionError {
  return error instanceof AlranUpdateAdmissionError;
}
