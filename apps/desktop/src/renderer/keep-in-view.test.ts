import { describe, expect, it } from 'vitest';
import { scrollDelta } from './keep-in-view.js';

const view = { top: 100, bottom: 300 };

describe('scrollDelta', () => {
  it('leaves a visible row alone', () => {
    expect(scrollDelta(view, { top: 120, bottom: 150 })).toBe(0);
    expect(scrollDelta(view, { top: 100, bottom: 300 })).toBe(0);
  });

  it('scrolls up for a row above the viewport', () => {
    expect(scrollDelta(view, { top: 60, bottom: 90 })).toBe(-40);
  });

  it('scrolls down for a row below the viewport', () => {
    expect(scrollDelta(view, { top: 310, bottom: 340 })).toBe(40);
  });

  it('aligns the top when a row is taller than the viewport', () => {
    expect(scrollDelta(view, { top: 80, bottom: 400 })).toBe(-20);
  });

  it('moves only to the nearest edge', () => {
    expect(scrollDelta(view, { top: 290, bottom: 320 })).toBe(20);
  });
});
