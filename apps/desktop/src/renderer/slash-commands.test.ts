import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  groupedSlashCommands,
  parseLeadingSlash,
  slashQueryFromDraft,
  toolForSlash,
} from './slash-commands.js';

describe('slash commands', () => {
  it('opens the full list for a lone slash', () => {
    expect(slashQueryFromDraft('/')).toBe('/');
    expect(filterSlashCommands('/')).toEqual(SLASH_COMMANDS);
    expect(groupedSlashCommands(SLASH_COMMANDS).map((group) => group.id)).toEqual(['session', 'mode', 'agent']);
  });

  it('stays open while filtering and closes after a space', () => {
    expect(slashQueryFromDraft('/ima')).toBe('/ima');
    expect(filterSlashCommands('/ima').map((entry) => entry.id)).toContain('imagine');
    expect(slashQueryFromDraft('/imagine a fox')).toBeNull();
    expect(slashQueryFromDraft('hello')).toBeNull();
    expect(filterSlashCommands('/zz').length).toBe(0);
  });

  it('parses the command and remainder', () => {
    expect(parseLeadingSlash('/imagine a fox')).toEqual({ id: 'imagine', rest: 'a fox' });
    expect(parseLeadingSlash('/new')).toEqual({ id: 'new', rest: '' });
    expect(parseLeadingSlash('hello')).toBeNull();
  });

  it('maps media commands onto tool flags', () => {
    expect(toolForSlash('imagine')).toBe('imagine');
    expect(toolForSlash('new')).toBeUndefined();
  });

  it('marks /rename as needing an argument so the palette does not fire empty', () => {
    expect(SLASH_COMMANDS.find((entry) => entry.id === 'rename')?.needsRest).toBe(true);
    expect(parseLeadingSlash('/rename')).toEqual({ id: 'rename', rest: '' });
    expect(parseLeadingSlash('/rename 설계 검토')).toEqual({ id: 'rename', rest: '설계 검토' });
  });
});
