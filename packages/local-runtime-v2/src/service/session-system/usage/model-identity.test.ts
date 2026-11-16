import { describe, expect, it } from 'vitest';

import { modelIdentity } from './model-identity.js';

describe('the model recorded with a usage row', () => {
  it('reads the model of the shape the turn host hands over (provider and model_id)', () => {
    // projectResolvedModel in the turn host produces exactly this shape.
    expect(
      modelIdentity({ provider: 'custom_provider:relay', model_id: 'big-model', max_tokens: 4096 }),
    ).toBe('custom_provider:relay/big-model');
  });

  it('still reads a model of the provider client shape (provider and id)', () => {
    expect(modelIdentity({ provider: 'openai', id: 'gpt' })).toBe('openai/gpt');
  });

  it('reads the camel-case spelling and a model without a provider', () => {
    expect(modelIdentity({ provider: 'p', modelId: 'm' })).toBe('p/m');
    expect(modelIdentity({ model_id: 'only-id' })).toBe('only-id');
  });

  it('records nothing for a value that names no model', () => {
    expect(modelIdentity(undefined)).toBeNull();
    expect(modelIdentity('model')).toBeNull();
    expect(modelIdentity({ provider: 'p' })).toBeNull();
    expect(modelIdentity({ provider: 'p', model_id: 7 })).toBeNull();
  });
});
