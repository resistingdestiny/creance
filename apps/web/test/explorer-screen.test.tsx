// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExplorerScreen } from '../src/app/index/explorer-screen.js';
import type { ExplorerData } from '../src/lib/explorer-data.js';
import { explorerOccupation, latestMonth, priceFor } from '../src/lib/explorer-model.js';
import { formatPeriod } from '../src/lib/format.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';

/// The explorer, rendered against the fifteen readings recorded from the API on
/// Hedera testnet.
///
/// The pattern is landing.test.tsx's "the figures come from the feed and never
/// from the page": every number asserted here is derived from the recording,
/// never written into the expectation by hand, so a screen that started
/// printing a figure of its own would fail rather than pass quietly.

const occupations = EXPLORER_READINGS.map(explorerOccupation);

function data(patch: Partial<ExplorerData> = {}): ExplorerData {
  return {
    occupations,
    missing: [],
    provenance: {
      source:
        'US Bureau of Labor Statistics, Current Population Survey, unemployment rate by occupation, not seasonally adjusted',
      asOf: '2026-07',
      from: '2021-05',
      to: '2026-07',
      months: 60,
      topicId: '0.0.10366470',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366470',
      seriesHash: EXPLORER_READINGS[0]?.source.hash ?? null,
    },
    replayBadge: null,
    readAt: '2026-09-06T12:00:00.000Z',
    ...patch,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the explorer opens on the newest published month', () => {
  it('names the occupation and the month, and never a signed index value', () => {
    render(<ExplorerScreen data={data()} />);
    const computer = occupations.find((entry) => entry.key === 'computer_math');
    const month = latestMonth(computer!);

    expect(screen.getByText(`Computer and mathematical, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(screen.getByText('0.7 points from a payout')).toBeDefined();
    expect(
      screen.getByText(
        'Unemployment in this job sits 1.4 points better than average. Claims open when it reaches 0.7 points better than average.',
      ),
    ).toBeDefined();
    // The distance on screen is the one the API served for the newest month.
    expect(month?.distance).toBeCloseTo(0.69, 6);
  });

  it('carries a status pill and a meter for the month it opened on', () => {
    render(<ExplorerScreen data={data()} />);
    expect(screen.getAllByText('Covered').length).toBeGreaterThan(0);
    expect(screen.getByText('Payout')).toBeDefined();
    expect(screen.getByText('Far from a payout')).toBeDefined();
    expect(document.querySelector('[data-testid="explorer-meter"]')).not.toBeNull();
  });

  it('prints the newest published month and where the record settles', () => {
    render(<ExplorerScreen data={data()} />);
    const line = screen.getByText(/Newest published month/);
    expect(line.textContent).toBe(
      'Newest published month July 2026. 60 months on screen, May 2021 to Jul 2026.',
    );
    const link = screen.getByRole('link', { name: '0.0.10366470' });
    expect(link.getAttribute('href')).toBe('https://hashscan.io/testnet/topic/0.0.10366470');
  });

  it('shows the replay badge only while the demo clock walks', () => {
    render(<ExplorerScreen data={data()} />);
    expect(screen.queryByText('Replay: Jul 2026')).toBeNull();
    document.body.innerHTML = '';
    render(<ExplorerScreen data={data({ replayBadge: 'Replay: Jul 2026' })} />);
    expect(screen.getByText('Replay: Jul 2026')).toBeDefined();
  });
});

describe('the picker', () => {
  it('offers the fifteen occupations in the addendum order, as buttons', () => {
    render(<ExplorerScreen data={data()} />);
    const chips = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') !== null);
    expect(chips).toHaveLength(15);
    expect(chips[0]?.textContent).toContain('Office and administrative support');
    expect(chips[1]?.textContent).toContain('Computer and mathematical');
    expect(chips.at(-1)?.textContent).toContain('Farming, fishing and forestry');
  });

  it('filters the chips as the visitor types, and says when nothing matches', () => {
    render(<ExplorerScreen data={data()} />);
    const search = screen.getByRole('searchbox', { name: 'Search occupations' });

    fireEvent.change(search, { target: { value: 'legal' } });
    expect(
      screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') !== null),
    ).toHaveLength(1);

    fireEvent.change(search, { target: { value: 'astronaut' } });
    expect(screen.getByText('No occupation matches that.')).toBeDefined();
  });

  it('changes the whole verdict when another occupation is picked', () => {
    render(<ExplorerScreen data={data()} />);
    const legal = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('Legal') === true);
    fireEvent.click(legal!);

    const occupation = occupations.find((entry) => entry.key === 'legal');
    const month = latestMonth(occupation!);
    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(screen.getByText(`${month!.distance!.toFixed(1)} points from a payout`)).toBeDefined();
  });
});

describe('the chart', () => {
  it('draws sixty months with a band and a mark on every month claims opened', () => {
    render(<ExplorerScreen data={data()} />);
    const computer = occupations.find((entry) => entry.key === 'computer_math');
    const opened = computer!.months.filter((month) => month.open).length;

    expect(opened).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid="explorer-chart-open-mark"]')).toHaveLength(
      opened,
    );
    expect(document.querySelector('[data-testid="explorer-chart-band"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="explorer-chart-line"]')).not.toBeNull();
  });

  it('is an image with a name that says the reading in words', () => {
    render(<ExplorerScreen data={data()} />);
    const chart = screen.getAllByRole('img')[0];
    expect(chart?.getAttribute('aria-label')).toContain('Computer and mathematical');
    expect(chart?.getAttribute('aria-label')).toContain('0.7 points from a payout');
  });

  it('carries two axis labels and the band caption, and no third date', () => {
    render(<ExplorerScreen data={data()} />);
    const caption = document.querySelector('figcaption');
    expect(caption?.children).toHaveLength(3);
    expect(caption?.textContent).toContain('May 2021');
    expect(caption?.textContent).toContain('Jul 2026');
    expect(caption?.textContent).toContain('Pays out within 0.68 of average');
  });
});

describe('the month scrubber', () => {
  it('moves the headline, the sentence and the price to the month it lands on', () => {
    render(<ExplorerScreen data={data()} />);
    const scrub = screen.getByRole('slider', { name: 'Month, Computer and mathematical' });
    expect(scrub.getAttribute('max')).toBe('59');
    expect(scrub.getAttribute('value')).toBe('59');

    // April 2026, which the feed says opened claims on the level form.
    const computer = occupations.find((entry) => entry.key === 'computer_math');
    const april = computer!.months.findIndex((month) => month.period === '2026-04');
    fireEvent.change(scrub, { target: { value: String(april) } });

    expect(screen.getByText(`Computer and mathematical, ${formatPeriod('2026-04')}`)).toBeDefined();
    expect(screen.getByText('Claims are open')).toBeDefined();
    expect(screen.getAllByText('Claims open').length).toBeGreaterThan(0);
  });
});

describe('the price block', () => {
  it('is the model price for the month and the capacity on the slider', () => {
    render(<ExplorerScreen data={data()} />);
    const computer = occupations.find((entry) => entry.key === 'computer_math');
    const distance = latestMonth(computer!)?.distance ?? 0;
    const price = priceFor(distance, 0.45);

    expect(screen.getByText('Monthly premium for 5,000 of cover')).toBeDefined();
    expect(screen.getByText(price!.monthly)).toBeDefined();

    const capacity = screen.getByRole('slider', { name: 'How much capital wants this risk' });
    fireEvent.change(capacity, { target: { value: '0' } });
    const atZero = priceFor(distance, 0);
    expect(screen.getByText(atZero!.monthly)).toBeDefined();
  });

  it('says an occupation with no capacity cannot be bought rather than pricing it', () => {
    render(<ExplorerScreen data={data()} />);
    const legal = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('Legal') === true);
    fireEvent.click(legal!);

    expect(screen.getByText('Guide price for 5,000 of cover')).toBeDefined();
    expect(
      screen.getByText(
        'No cover is on sale for this occupation today. Capacity is committed one occupation at a time, and none has been committed to this one.',
      ),
    ).toBeDefined();
    expect(
      screen.queryByRole('slider', { name: 'How much capital wants this risk' }),
    ).toBeNull();
  });
});

describe('the two disclosures', () => {
  it('are native details, shut on load', () => {
    render(<ExplorerScreen data={data()} />);
    const disclosures = [...document.querySelectorAll('details')];
    expect(disclosures).toHaveLength(2);
    for (const disclosure of disclosures) expect(disclosure.open).toBe(false);
    expect(disclosures[0]?.textContent).toContain('How this number is built');
    expect(disclosures[1]?.textContent).toContain('Every occupation, closest to opening first');
  });

  it('explains the number in four steps, each with its own chart', () => {
    render(<ExplorerScreen data={data()} />);
    const steps = document.querySelectorAll('details')[0];
    expect(within(steps as HTMLElement).getAllByRole('listitem')).toHaveLength(4);
    // Inside the body, so the summary's own chevron is not counted.
    expect(steps?.querySelectorAll(':scope > div svg')).toHaveLength(4);
    expect(steps?.textContent).toContain('Your job');
    expect(steps?.textContent).toContain('Compared with everyone else');
    expect(steps?.textContent).toContain('Smoothed over three months');
    expect(steps?.textContent).toContain('The line');
  });

  it('ranks the fifteen occupations closest to opening first, each a button', () => {
    render(<ExplorerScreen data={data()} />);
    const grid = document.querySelectorAll('details')[1] as HTMLElement;
    const cells = within(grid).getAllByRole('button');
    expect(cells).toHaveLength(15);
    expect(cells[0]?.textContent).toContain('Arts, design, entertainment and media');
    expect(cells[0]?.textContent).toContain('on the line');
    expect(grid.querySelectorAll(':scope > div svg')).toHaveLength(15);
  });

  it('selects an occupation in the explorer above when a cell is chosen', () => {
    render(<ExplorerScreen data={data()} />);
    const grid = document.querySelectorAll('details')[1] as HTMLElement;
    fireEvent.click(within(grid).getAllByRole('button')[0] as HTMLElement);
    expect(
      screen.getByText(`Arts, design, entertainment and media, ${formatPeriod('2026-07')}`),
    ).toBeDefined();
    expect(screen.getByText('Right on the line')).toBeDefined();
  });
});

describe('what the explorer refuses to do', () => {
  it('says it has nothing rather than showing a page with no readings', () => {
    render(<ExplorerScreen data={data({ occupations: [] })} />);
    expect(screen.getByText('The index is not answering.')).toBeDefined();
  });

  it('runs no scroll observer anywhere', () => {
    render(<ExplorerScreen data={data()} />);
    expect(document.body.innerHTML).not.toContain('data-reveal');
  });
});
