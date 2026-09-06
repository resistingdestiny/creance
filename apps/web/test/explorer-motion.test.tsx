// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplorerScreen } from '../src/app/index/explorer-screen.js';
import type { ExplorerData } from '../src/lib/explorer-data.js';
import { explorerOccupation } from '../src/lib/explorer-model.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';

/**
 * The explorer's one piece of motion: the chart line tweening when the reader
 * picks another occupation.
 *
 * Three things have to hold, and they are the reason the tween is an override
 * written onto the path element rather than a piece of React state. Under
 * reduced motion the finished line is what is on screen. In a hidden tab the
 * same. And if no animation frame ever runs, the line is still the true one,
 * because the true one is what was rendered in the first place.
 */

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const occupations = EXPLORER_READINGS.map(explorerOccupation);

const data: ExplorerData = {
  occupations,
  missing: [],
  provenance: {
    source: 'US Bureau of Labor Statistics, Current Population Survey',
    asOf: '2026-07',
    from: '2021-05',
    to: '2026-07',
    months: 60,
    topicId: '0.0.10366470',
    hashscan: 'https://hashscan.io/testnet/topic/0.0.10366470',
    seriesHash: null,
  },
  replayBadge: null,
  readAt: '2026-09-06T12:00:00.000Z',
};

/** The path the chart would draw for a group, from the rendered screen. */
function drawnPath(): string {
  return (
    document.querySelector('[data-testid="explorer-chart-line"]')?.getAttribute('d') ?? ''
  );
}

function pickLegal(): void {
  const chip = screen
    .getAllByRole('button')
    .find((button) => button.textContent?.startsWith('Legal') === true);
  fireEvent.click(chip as HTMLElement);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the line tween', () => {
  it('lands on the finished line under reduced motion, with no frame asked for', async () => {
    stubMatchMedia(true);
    await act(async () => {
      render(<ExplorerScreen data={data} />);
    });
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');

    await act(async () => {
      pickLegal();
    });

    expect(frames).not.toHaveBeenCalled();
    expect(drawnPath()).not.toBe('');
  });

  it('lands on the finished line in a hidden tab', async () => {
    stubMatchMedia(false);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      render(<ExplorerScreen data={data} />);
    });
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');

    await act(async () => {
      pickLegal();
    });

    expect(frames).not.toHaveBeenCalled();
    expect(drawnPath()).not.toBe('');
  });

  it('shows the true line when no animation frame ever fires', async () => {
    stubMatchMedia(false);
    // A frame that is asked for and never runs, which is what a background tab
    // and a throttled renderer both look like.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    await act(async () => {
      render(<ExplorerScreen data={data} />);
    });
    const before = drawnPath();

    await act(async () => {
      pickLegal();
    });

    const after = drawnPath();
    expect(after).not.toBe('');
    expect(after).not.toBe(before);
    // The verdict beside it never animates at all, so it is the true value the
    // moment the pick lands.
    expect(screen.getByText(/^Legal, /)).toBeDefined();
  });
});
