import { describe, expect, it } from 'vitest';
import { PALETTE_COMMANDS, filterPaletteCommands } from './command-palette.js';

describe('filterPaletteCommands', () => {
  it('returns the full list for an empty or > query', () => {
    expect(filterPaletteCommands('')).toEqual(PALETTE_COMMANDS);
    expect(filterPaletteCommands('>')).toEqual(PALETTE_COMMANDS);
  });

  it('matches title, id, and keywords', () => {
    expect(filterPaletteCommands('리뷰').map((entry) => entry.id)).toContain('review');
    expect(filterPaletteCommands('>worktree').map((entry) => entry.id)).toContain('worktree');
    expect(filterPaletteCommands('btw').map((entry) => entry.id)).toContain('side-ask');
  });
});
