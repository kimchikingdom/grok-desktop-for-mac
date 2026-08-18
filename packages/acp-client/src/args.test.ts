import { describe, expect, it } from 'vitest';
import { buildArgs } from './connection.js';

describe('buildArgs', () => {
  it('uses the plain agent stdio invocation without a model', () => {
    expect(buildArgs({})).toEqual(['agent', 'stdio']);
  });

  it('places --sandbox before agent', () => {
    expect(buildArgs({ sandbox: 'workspace' })).toEqual(['--sandbox', 'workspace', 'agent', 'stdio']);
  });

  it('puts -m before the stdio subcommand', () => {
    // `grok agent stdio -m X` exits with code 2: the flag belongs to `agent`.
    expect(buildArgs({ model: 'grok-4.5' })).toEqual(['agent', '-m', 'grok-4.5', 'stdio']);
  });

  it('keeps custom args intact and still places the flag correctly', () => {
    expect(buildArgs({ args: ['agent', 'stdio', '--debug'], model: 'grok-4.6' })).toEqual([
      'agent',
      '-m',
      'grok-4.6',
      'stdio',
      '--debug',
    ]);
  });

  it('falls back to appending when there is no stdio subcommand (test harness)', () => {
    expect(buildArgs({ args: ['/path/fake-agent.mjs', 'basic'], model: 'grok-4.6' })).toEqual([
      '/path/fake-agent.mjs',
      'basic',
      '-m',
      'grok-4.6',
    ]);
  });
});
