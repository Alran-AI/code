import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { BpeTokenEstimator } from '../src/token-estimator.js';

const prose = '中文上下文内容。'.repeat(2_000);
const blob = (length: number): string => 'A'.repeat(length);

describe('token estimate of a text that contains an oversized unbroken run', () => {
  const estimator = new BpeTokenEstimator();

  it('charges the byte bound to the oversized run only, not to the text around it', () => {
    const text = `${prose}${blob(5_000)}`;
    const wholeTextBound = Buffer.byteLength(text, 'utf8');

    const estimate = estimator.estimateTextTokens(text);

    // The prose is counted by the tokenizer, the run by its bytes.
    expect(estimate).toBeLessThan(wholeTextBound / 2);
    expect(estimate).toBeGreaterThanOrEqual(estimator.estimateTextTokens(prose) + 5_000);
    expect(estimate).toBeLessThanOrEqual(estimator.estimateTextTokens(prose) + 5_000 + 4);
  });

  it('handles runs before, between and after ordinary text', () => {
    const text = `${blob(4_200)} one two three ${blob(4_300)}\n${prose}${blob(4_100)}`;

    const estimate = estimator.estimateTextTokens(text);

    const runBytes = 4_200 + 4_300 + 4_100;
    expect(estimate).toBeLessThanOrEqual(
      runBytes + estimator.estimateTextTokens(` one two three \n${prose}`) + 8,
    );
    expect(estimate).toBeGreaterThanOrEqual(runBytes);
  });

  it('keeps the byte bound for a text that is nothing but the oversized run', () => {
    expect(estimator.estimateTextTokens(blob(60_000))).toBe(60_000);
  });

  it('counts a run that is long but not oversized with the tokenizer, as before', () => {
    const atTheLimit = `${prose}${blob(4_096)}`;

    expect(estimator.estimateTextTokens(atTheLimit)).toBeLessThan(
      Buffer.byteLength(atTheLimit, 'utf8') / 2,
    );
  });

  it('does not change the estimate of text without an oversized run', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(500);

    expect(estimator.estimateTextTokens(text)).toBe(new BpeTokenEstimator().estimateTextTokens(text));
    expect(estimator.estimateTextTokens(text)).toBeLessThan(text.length / 3);
  });

  it('measures the run in letters and digits of any script', () => {
    const cyrillic = 'Ж'.repeat(5_000);
    const text = `${prose}${cyrillic}`;

    expect(estimator.estimateTextTokens(text)).toBeGreaterThanOrEqual(
      Buffer.byteLength(cyrillic, 'utf8'),
    );
    expect(estimator.estimateTextTokens(text)).toBeLessThan(Buffer.byteLength(text, 'utf8') * 0.75);
  });
});
