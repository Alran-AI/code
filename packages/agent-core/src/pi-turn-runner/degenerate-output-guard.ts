import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { partialOf, releaseIterator, snapshot } from './llm-stream-timeout.js';

/**
 * Shown when a model's output is cut off because it fell into a loop. The wording is plain on
 * purpose: it contains none of the transport markers the retry layer treats as retryable, so the
 * same looping request is not sent again automatically.
 */
export const DEGENERATE_OUTPUT_MESSAGE =
  'Generation stopped: repetitive output detected (model may be looping).';

/** Environment switch: `0` or `off` turns the guard off. */
export const OUTPUT_LOOP_GUARD_ENV = 'ALRAN_OUTPUT_LOOP_GUARD';

// How much of the most recent output is kept for the checks.
const WINDOW_CHARS = 16_384;

// A short unit (1 to 16 UTF-16 units) repeated back to back. A unit made of symbols, emoji or
// punctuation has to repeat 200 times (and cover 400 characters); a unit with letters or digits
// is far more common in legitimate output (padding, tables of zeros), so it needs 600 repeats
// covering 6000 characters. Units of whitespace and drawing characters (rules, separators,
// indentation) never count.
const MAX_UNIT_LENGTH = 16;
const SYMBOL_MIN_REPEATS = 200;
const SYMBOL_MIN_CHARS = 400;
const WORD_MIN_REPEATS = 600;
const WORD_MIN_CHARS = 6_000;

// The same line (at least 12 characters, with a letter or digit) written 50 times in a row.
const MIN_REPEATED_LINE_CHARS = 12;
const MIN_REPEATED_LINES = 50;

const SEPARATOR_ONLY = /^[\s\-=_*#~.+|:`'"<>/\\^\u2500-\u259F]*$/u;
const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * Notices a model that has started to repeat itself without end: the same emoji or symbol,
 * a short pattern, or one line written again and again. Feed it the text of one stream, in order.
 * The limits are high enough that tables, rules, indentation and ordinary repetitive code or
 * data do not trip them.
 */
export class DegenerateOutputDetector {
  private tail = '';
  private lineStart = 0;
  private repeatedLine: string | undefined;
  private repeatedLineCount = 0;

  /** Returns true once the text so far ends in a loop. */
  feed(delta: string): boolean {
    if (!delta) return false;
    this.tail += delta;
    if (this.tail.length > WINDOW_CHARS * 2) this.trim();
    return this.endsInRepeatedUnit() || this.noticeLines();
  }

  private trim(): void {
    const drop = this.tail.length - WINDOW_CHARS;
    this.tail = this.tail.slice(drop);
    this.lineStart = Math.max(0, this.lineStart - drop);
  }

  private endsInRepeatedUnit(): boolean {
    const text = this.tail;
    const length = text.length;
    if (length < SYMBOL_MIN_CHARS) return false;
    for (let unitLength = 1; unitLength <= MAX_UNIT_LENGTH; unitLength += 1) {
      // Count how far back the text repeats with this period.
      let matched = 0;
      for (let index = length - 1; index - unitLength >= 0; index -= 1) {
        if (text.charCodeAt(index) !== text.charCodeAt(index - unitLength)) break;
        matched += 1;
        // Nothing repeats long enough to matter before a cheaper bound is reached.
        if (matched >= WORD_MIN_CHARS) break;
      }
      const repeatedChars = matched + unitLength;
      if (repeatedChars < SYMBOL_MIN_CHARS) continue;
      const unit = text.slice(length - unitLength);
      if (SEPARATOR_ONLY.test(unit)) continue;
      const repeats = repeatedChars / unitLength;
      const wordLike = HAS_ALPHANUMERIC.test(unit);
      if (wordLike) {
        if (repeats >= WORD_MIN_REPEATS && repeatedChars >= WORD_MIN_CHARS) return true;
      } else if (repeats >= SYMBOL_MIN_REPEATS && repeatedChars >= SYMBOL_MIN_CHARS) {
        return true;
      }
    }
    return false;
  }

  private noticeLines(): boolean {
    let newline = this.tail.indexOf('\n', this.lineStart);
    while (newline !== -1) {
      const line = this.tail.slice(this.lineStart, newline).trim();
      this.lineStart = newline + 1;
      if (this.countLine(line)) return true;
      newline = this.tail.indexOf('\n', this.lineStart);
    }
    return false;
  }

  private countLine(line: string): boolean {
    if (line.length < MIN_REPEATED_LINE_CHARS || !HAS_ALPHANUMERIC.test(line)) {
      this.repeatedLine = undefined;
      this.repeatedLineCount = 0;
      return false;
    }
    if (line === this.repeatedLine) {
      this.repeatedLineCount += 1;
    } else {
      this.repeatedLine = line;
      this.repeatedLineCount = 1;
    }
    return this.repeatedLineCount >= MIN_REPEATED_LINES;
  }
}

export function outputLoopGuardEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env[OUTPUT_LOOP_GUARD_ENV]?.trim().toLowerCase();
  return value !== '0' && value !== 'off';
}

/**
 * Wrap a StreamFn so a response that falls into a loop is cut off instead of running until the
 * output cap or the user's Esc. The request is aborted through a linked signal and the returned
 * stream ends with an `error` event carrying what was produced so far and
 * {@link DEGENERATE_OUTPUT_MESSAGE}. Assistant text and thinking are watched separately; tool
 * call arguments are not. A caller abort passes through unchanged.
 */
export function withDegenerateOutputGuard(inner: StreamFn | undefined): StreamFn {
  const base = inner ?? streamSimple;
  return ((model, context, options) => {
    if (!outputLoopGuardEnabled()) return base(model, context, options);
    const callerSignal = options?.signal;
    const controller = new AbortController();
    const out = createAssistantMessageEventStream();
    const text = new DegenerateOutputDetector();
    const thinking = new DegenerateOutputDetector();
    let lastPartial: AssistantMessage | undefined;
    let finished = false;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) controller.abort(callerSignal.reason);
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const finish = () => {
      finished = true;
      callerSignal?.removeEventListener('abort', onCallerAbort);
    };

    void (async () => {
      try {
        const stream: AssistantMessageEventStream = await base(model, context, {
          ...(options ?? {}),
          signal: controller.signal,
        });
        const iterator = stream[Symbol.asyncIterator]();
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          const event = next.value;
          const partial = partialOf(event);
          if (partial) lastPartial = partial;
          const looping =
            (event.type === 'text_delta' && text.feed(event.delta)) ||
            (event.type === 'thinking_delta' && thinking.feed(event.delta));
          if (looping) {
            finish();
            controller.abort(new Error(DEGENERATE_OUTPUT_MESSAGE));
            releaseIterator(iterator);
            out.push({
              type: 'error',
              reason: 'error',
              error: {
                ...snapshot(lastPartial, model),
                stopReason: 'error',
                errorMessage: DEGENERATE_OUTPUT_MESSAGE,
              },
            });
            out.end();
            return;
          }
          out.push(event);
          if (event.type === 'done' || event.type === 'error') {
            finish();
            out.end();
            return;
          }
        }
        if (!finished) {
          finish();
          const final = await stream.result();
          out.push(
            final.stopReason === 'error' || final.stopReason === 'aborted'
              ? { type: 'error', reason: final.stopReason, error: final }
              : { type: 'done', reason: final.stopReason, message: final },
          );
          out.end();
        }
      } catch (error) {
        if (finished) return;
        finish();
        const aborted = callerSignal?.aborted === true;
        out.push({
          type: 'error',
          reason: aborted ? 'aborted' : 'error',
          error: {
            ...snapshot(lastPartial, model),
            stopReason: aborted ? 'aborted' : 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
        out.end();
      }
    })();

    return out;
  }) as StreamFn;
}
