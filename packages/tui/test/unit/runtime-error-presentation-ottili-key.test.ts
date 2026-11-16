import { LLM_ERROR_CODES } from '@alran/shared/llm-error-classifier';
import { describe, expect, it } from 'vitest';

import { resolveTuiRuntimeFailure } from '../../src/tui/controller/runtime/runtime-error-presentation.js';

// Claude runs on the customer's own Anthropic API key, held by the Ottili gateway. A turn that fails because
// that key is missing or refused is not "Access denied" and not a transient outage: it says what to do.

describe('a Claude turn that fails on the customer\'s Anthropic key', () => {
  it.each([
    ['not stored', 'byok_key_required', 'Anthropic models run on your own Anthropic API key. Add it under Settings → Provider keys.'],
    ['refused earlier', 'byok_key_invalid', 'Anthropic refused your API key. Replace it under Settings → Provider keys.'],
    ['refused now', 'byok_key_rejected', 'Anthropic rejected your API key. Replace it under Settings → Provider keys.'],
    ['without credit', 'byok_provider_billing', 'Your Anthropic account cannot pay for this request. Anthropic bills this usage to you, not Ottili.'],
  ])('says where the key lives when it was %s, and is not retried', (_name, gatewayCode, sentence) => {
    const failure = resolveTuiRuntimeFailure(`403 ${sentence}`, 403, { errorDetail: `${gatewayCode}: ${sentence}` });
    expect(failure.retryable).toBe(false);
    expect(failure.content).toContain('Claude could not run on your Anthropic key.');
    expect(failure.content).toContain('Settings → Provider keys');
    expect(failure.content).toContain('/model');
    expect(failure.content).not.toContain('Access denied');
    expect(failure.content).not.toContain('/retry');
  });

  it('leaves an ordinary 403, and the keys of the user\'s own providers, to their own messages', () => {
    const ordinary = resolveTuiRuntimeFailure('403 Forbidden', 403);
    expect(ordinary.content).toContain('Access denied.');
    const own = resolveTuiRuntimeFailure('BYOK provider custom:x upstream error: 401 invalid x-api-key', LLM_ERROR_CODES.LLM_AUTH_ERROR, { errorSource: 'byok_upstream' });
    expect(own.content).toContain('The model provider rejected its credentials.');
    expect(own.content).not.toContain('Claude could not run on your Anthropic key.');
  });
});
