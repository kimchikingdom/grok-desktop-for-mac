import { describe, expect, it } from 'vitest';
import { initializeResultSchema } from './protocol.js';

/** Trimmed from a real `grok agent stdio` handshake (grok CLI 1.0.3). */
const REAL_INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
  authMethods: [{ id: 'cached_token', name: 'cached_token' }],
  _meta: {
    grokShell: true,
    agentVersion: '1.0.3',
    modelState: {
      currentModelId: 'grok-4.6',
      availableModels: [
        {
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
          description: 'Latest frontier model',
          _meta: { totalContextTokens: 500000, agentType: 'grok-build-plan' },
        },
        { modelId: 'grok-4.5', name: 'Grok 4.5' },
      ],
    },
  },
};

describe('initialize model state', () => {
  it('extracts the model catalogue from _meta', () => {
    const parsed = initializeResultSchema.safeParse(REAL_INITIALIZE);
    expect(parsed.success).toBe(true);
    const state = parsed.data?._meta?.modelState;
    expect(state?.currentModelId).toBe('grok-4.6');
    expect(state?.availableModels.map((model) => model.modelId)).toEqual(['grok-4.6', 'grok-4.5']);
    expect(state?.availableModels[0]?._meta?.totalContextTokens).toBe(500_000);
  });

  it('still parses a handshake without model information', () => {
    const parsed = initializeResultSchema.safeParse({ protocolVersion: 1 });
    expect(parsed.success).toBe(true);
    expect(parsed.data?._meta?.modelState).toBeUndefined();
  });

  it('keeps loadSession detection working', () => {
    const parsed = initializeResultSchema.safeParse(REAL_INITIALIZE);
    expect(parsed.data?.agentCapabilities?.loadSession).toBe(true);
  });
});
