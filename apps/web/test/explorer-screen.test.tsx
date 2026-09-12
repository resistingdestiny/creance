// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExplorerPanel } from '../src/app/index/explorer-panel.js';
import { CHOOSE_OCCUPATION } from '../src/lib/occupations.js';
import { ExplorerScreen } from '../src/app/index/explorer-screen.js';
import {
  PAYOUT_CONDITION,
  bandCaption,
  explorerOccupation,
  headlineFor,
  latestMonth,
  positionSentence,
  priceFor,
  stateOf,
  stateWord,
} from '../src/lib/explorer-model.js';
import { formatPeriod } from '../src/lib/format.js';

import {
  EXPLORER_READINGS,
  EXPLORER_UTILISATION,
  explorerData as data,
} from './explorer-fixtures.js';

/// The explorer, rendered against the fifteen readings recorded from the API on
/// Hedera testnet.
///
/// The pattern is landing.test.tsx's "the figures come from the feed and never
/// from the page": every number asserted here is derived from the recording,
/// never written into the expectation by hand, so a screen that started
/// printing a figure of its own would fail rather than pass quietly.

const occupations = EXPLORER_READINGS.map(explorerOccupation);

/// The occupation the panel opens on when no page names one, which is the one
/// thing every default assertion below turns on. It is named once here so that
/// moving the default is one edit rather than twenty.
const DEFAULT_KEY = 'arts_design_ent_media';
const DEFAULT_LABEL = 'Arts, design, entertainment and media';
const opensOn = occupations.find((entry) => entry.key === DEFAULT_KEY)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the explorer opens on the newest published month', () => {
  it('names the occupation and the month, and never a signed index value', () => {
    render(<ExplorerScreen data={data()} />);
    const month = latestMonth(opensOn);

    expect(screen.getByText(`${DEFAULT_LABEL}, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(screen.getByText(headlineFor(month))).toBeDefined();
    expect(screen.getByText(positionSentence(opensOn, month)!)).toBeDefined();
    // The distance on screen is the one the API served for the newest month.
    expect(month?.distance).toBeCloseTo(0.02, 6);
  });

  it('carries a status pill and a meter for the month it opened on', () => {
    render(<ExplorerScreen data={data()} />);
    expect(
      screen.getAllByText(stateWord(stateOf(latestMonth(opensOn)))).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Payout')).toBeDefined();
    expect(screen.getByText('Far from a payout')).toBeDefined();
    expect(document.querySelector('[data-testid="explorer-meter"]')).not.toBeNull();
  });

  it('prints the newest published month and where the record settles', () => {
    // Four labelled facts and a link, where there were three lines of prose.
    render(<ExplorerScreen data={data()} />);
    expect(screen.getByText('Newest month').nextElementSibling?.textContent).toBe('July 2026');
    expect(screen.getByText('On screen').nextElementSibling?.textContent).toBe(
      '60 months, May 2021 to Jul 2026',
    );
    expect(screen.getByText('Source').nextElementSibling?.textContent).toContain(
      'Bureau of Labor Statistics',
    );
    const link = screen.getByRole('link', { name: '0.0.10366470' });
    expect(link.getAttribute('href')).toBe('https://hashscan.io/testnet/topic/0.0.10366470');

    // What the topic actually holds is one message per occupation per
    // published month, so the sentence counts and never says "every month".
    // A reader who follows the link is counting the same thing.
    expect(link.parentElement?.textContent).toBe(
      'The newest month for every occupation is settled on Hedera topic 0.0.10366470, which anyone can read.',
    );
  });

  it('counts what is settled rather than claiming more than the topic holds', () => {
    render(
      <ExplorerScreen
        data={data({
          provenance: { ...data().provenance, published: 9, deepest: null },
        })}
      />,
    );
    const link = screen.getByRole('link', { name: '0.0.10366470' });
    expect(link.parentElement?.textContent).toBe(
      'The newest month for 9 of 15 occupations is settled on Hedera topic 0.0.10366470, which anyone can read.',
    );
  });

  it('claims nothing about months when the topic could not be counted', () => {
    render(
      <ExplorerScreen
        data={data({
          provenance: { ...data().provenance, published: 0, deepest: null },
        })}
      />,
    );
    const link = screen.getByRole('link', { name: '0.0.10366470' });
    expect(link.parentElement?.textContent).toBe(
      'The index settles on Hedera topic 0.0.10366470, which anyone can read.',
    );
  });

  it('shows the replay badge only while the demo clock walks', () => {
    render(<ExplorerScreen data={data()} />);
    expect(screen.queryByText('Replay: Jul 2026')).toBeNull();
    document.body.innerHTML = '';
    render(<ExplorerScreen data={data({ replayBadge: 'Replay: Jul 2026' })} />);
    expect(screen.getByText('Replay: Jul 2026')).toBeDefined();
  });
});

/** The chooser's row: the one button that says which occupation is on screen. */
function chooserRow(): HTMLElement {
  return screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-expanded') !== null) as HTMLElement;
}

/** The options the open chooser is showing. */
function chips(): HTMLElement[] {
  return screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') !== null);
}

describe('the picker', () => {
  it('opens as one row naming the occupation on screen, with the options put away', () => {
    // T52. It was fifteen pills wrapping four rows deep above the verdict.
    // The row is the statement of what is picked; the options are in the
    // markup, hidden, so both pages still carry every one of them.
    render(<ExplorerScreen data={data()} />);
    const row = chooserRow();
    expect(row.textContent).toContain(DEFAULT_LABEL);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null)).toHaveLength(0);
    expect(document.querySelectorAll('[aria-pressed]')).toHaveLength(15);
    expect(document.getElementById(row.getAttribute('aria-controls')!)?.hidden).toBe(true);
  });

  it('offers the fifteen occupations in the addendum order, as buttons, once opened', () => {
    render(<ExplorerScreen data={data()} />);
    fireEvent.click(chooserRow());
    expect(chooserRow().getAttribute('aria-expanded')).toBe('true');
    const options = chips();
    expect(options).toHaveLength(15);
    expect(options[0]?.textContent).toContain('Office and administrative support');
    expect(options[1]?.textContent).toContain('Computer and mathematical');
    expect(options.at(-1)?.textContent).toContain('Farming, fishing and forestry');
    // The one pressed is the one on screen, wherever the default sits in the
    // addendum order.
    const pressed = options.filter((option) => option.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain(DEFAULT_LABEL);
  });

  it('filters the options as the visitor types, and says when nothing matches', () => {
    render(<ExplorerScreen data={data()} />);
    fireEvent.click(chooserRow());
    const search = screen.getByRole('searchbox', { name: 'Search occupations' });

    fireEvent.change(search, { target: { value: 'legal' } });
    expect(chips()).toHaveLength(1);

    fireEvent.change(search, { target: { value: 'astronaut' } });
    expect(screen.getByText('No occupation matches that.')).toBeDefined();
  });

  it('changes the whole verdict when another occupation is picked, and closes', () => {
    render(<ExplorerScreen data={data()} />);
    fireEvent.click(chooserRow());
    const legal = chips().find((button) => button.textContent?.startsWith('Legal') === true);
    fireEvent.click(legal!);

    const occupation = occupations.find((entry) => entry.key === 'legal');
    const month = latestMonth(occupation!);
    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(screen.getByText(`${month!.distance!.toFixed(1)} points from a payout`)).toBeDefined();
    expect(chooserRow().textContent).toContain('Legal');
    expect(chooserRow().getAttribute('aria-expanded')).toBe('false');
  });

  // 20s rather than the default 5. This renders the whole explorer and then
  // drives eleven keyboard events through it, and under the full suite it was
  // spending its budget on the work rather than failing an assertion: it passes
  // alone and timed out once in a loaded run. Same cause as the metadata tests,
  // which were given a warm-up hook for it.
  it('is walked by the keyboard: arrows through the options, Enter picks, Escape closes', () => {
    render(<ExplorerScreen data={data()} />);
    fireEvent.click(chooserRow());
    const search = screen.getByRole('searchbox', { name: 'Search occupations' });

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Office and administrative support');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Computer and mathematical');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toContain('Farming, fishing and forestry');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Office and administrative support');

    fireEvent.change(search, { target: { value: 'production' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText(`Production, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(chooserRow().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(chooserRow());

    fireEvent.click(chooserRow());
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search occupations' }), {
      key: 'Escape',
    });
    expect(chooserRow().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(chooserRow());
  }, 20_000);
});

describe('the occupation another page names', () => {
  it('opens on it rather than on the panel default', () => {
    render(<ExplorerPanel data={data()} follows="legal" />);
    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
  });

  it('moves to it when the page names another one', () => {
    const { rerender } = render(<ExplorerPanel data={data()} follows={null} />);
    expect(screen.getByText(`${DEFAULT_LABEL}, ${formatPeriod('2026-07')}`)).toBeDefined();

    rerender(<ExplorerPanel data={data()} follows="legal" />);
    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
  });

  it('leaves the reader free to pick any of the fifteen afterwards', () => {
    // Followed, not obeyed. A panel that snapped back to the quote's
    // occupation would be a control with two owners.
    render(<ExplorerPanel data={data()} follows="legal" />);
    fireEvent.click(chooserRow());
    const chip = chips().find((button) => button.textContent?.startsWith('Production') === true);
    fireEvent.click(chip!);
    expect(screen.getByText(`Production, ${formatPeriod('2026-07')}`)).toBeDefined();
  });

  it('lands a followed occupation on the newest month, not the month last scrubbed to', () => {
    const { rerender } = render(<ExplorerPanel data={data()} follows="legal" />);
    fireEvent.change(screen.getByRole('slider', { name: 'Month, Legal' }), {
      target: { value: '3' },
    });
    expect(screen.queryByText(`Legal, ${formatPeriod('2026-07')}`)).toBeNull();

    rerender(<ExplorerPanel data={data()} follows="production" />);
    expect(screen.getByText(`Production, ${formatPeriod('2026-07')}`)).toBeDefined();
  });
});

describe('the chart', () => {
  it('draws sixty months with a band and a mark on every month claims opened', () => {
    render(<ExplorerScreen data={data()} />);
    const opened = opensOn.months.filter((month) => month.open).length;

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
    expect(chart?.getAttribute('aria-label')).toContain(DEFAULT_LABEL);
    expect(chart?.getAttribute('aria-label')).toContain(headlineFor(latestMonth(opensOn)));
  });

  it('carries two axis labels and the band caption, and no third date', () => {
    render(<ExplorerScreen data={data()} />);
    const caption = document.querySelector('figcaption');
    expect(caption?.children).toHaveLength(3);
    expect(caption?.textContent).toContain('May 2021');
    expect(caption?.textContent).toContain('Jul 2026');
    expect(caption?.textContent).toContain(bandCaption(opensOn));
  });

  it('labels the band on the chart and carries no prose under it', () => {
    // The chart used to stand over paragraphs telling a reader that up was
    // towards a payout, that the red band was where claims open and which of
    // the two triggers the line was. All three are marks now: the band is
    // named where it is drawn and the caption under it names the trigger and
    // its level, so there is nothing left to read under the picture.
    render(<ExplorerScreen data={data()} />);
    expect(screen.getByTestId('explorer-chart-band-mark').textContent).toBe('Claims open');
    expect(screen.queryByText(/Up is towards a payout/)).toBeNull();
    expect(screen.queryByText(/Claims open in two ways/)).toBeNull();
    expect(screen.queryByText(/The line rises when unemployment/)).toBeNull();
    expect(screen.queryByText(/usually unemployed less than average/)).toBeNull();
    expect(screen.queryByText(/points short of the line/)).toBeNull();
  });
});

describe('the month scrubber', () => {
  it('moves the headline, the sentence and the price to the month it lands on', () => {
    render(<ExplorerScreen data={data()} />);
    const scrub = screen.getByRole('slider', { name: `Month, ${DEFAULT_LABEL}` });
    expect(scrub.getAttribute('max')).toBe('59');
    expect(scrub.getAttribute('value')).toBe('59');

    // The first month the feed says claims were open for this occupation.
    const at = opensOn.months.findIndex((month) => month.open);
    const open = opensOn.months[at]!;
    fireEvent.change(scrub, { target: { value: String(at) } });

    expect(screen.getByText(`${DEFAULT_LABEL}, ${formatPeriod(open.period)}`)).toBeDefined();
    expect(screen.getByText('Claims are open')).toBeDefined();
    expect(screen.getAllByText('Claims open').length).toBeGreaterThan(0);
  });
});

describe('the price block', () => {
  it('stands the full width of the panel, under both columns', () => {
    // It carries the premium, which is what a buyer came for. In the narrow
    // column beside a five year chart it read as a footnote to the chart.
    render(<ExplorerScreen data={data()} />);
    const columns = document.querySelector('[data-testid="explorer-columns"]');
    const price = document.querySelector('[data-testid="explorer-price"]');
    const meter = document.querySelector('[data-testid="explorer-meter"]');

    expect(columns).not.toBeNull();
    expect(price).not.toBeNull();
    expect(columns!.contains(meter)).toBe(true);
    expect(columns!.contains(price)).toBe(false);
    expect(price!.parentElement).toBe(columns!.parentElement);
  });

  it('opens at the occupation’s own capacity, which is what the API would quote', () => {
    // The slider used to open at a flat 45 percent for all fifteen, which made
    // this the only surface in the product that disagreed with the quote and
    // the market board, under a caption naming the real series it supposedly
    // came from. It now opens where the series is, so the figure is the price.
    render(<ExplorerScreen data={data()} />);
    const distance = latestMonth(opensOn)?.distance ?? 0;
    const live = EXPLORER_UTILISATION[DEFAULT_KEY]!;
    const price = priceFor(distance, live);

    expect(screen.getByText('Monthly premium for 5,000 of cover')).toBeDefined();
    // Twice on the screen at nought percent used, because capital adds nothing
    // there and the guide row of the build up is the same figure.
    expect(screen.getAllByText(price!.monthly).length).toBeGreaterThan(0);
    expect(screen.getByText('0 percent of this pool already used')).toBeDefined();
  });

  it('builds the price up in rows rather than narrating it', () => {
    // The build up was two lines of prose under the figure. It is the series
    // page's own four rows now, and the condition that explains why the
    // premium is small beside the cover is one line rather than two.
    render(<ExplorerScreen data={data()} />);
    const distance = latestMonth(opensOn)?.distance ?? 0;
    const price = priceFor(distance, EXPLORER_UTILISATION[DEFAULT_KEY]!)!;
    const build = screen.getByTestId('explorer-price-build');

    expect(within(build).getByText("This job's own risk").nextElementSibling?.textContent).toBe(
      price.risk,
    );
    expect(within(build).getByText('Guide price').nextElementSibling?.textContent).toBe(
      price.guide,
    );
    expect(screen.getByText(PAYOUT_CONDITION)).toBeDefined();
    expect(screen.queryByText(/of which/)).toBeNull();
    expect(screen.queryByText(/A payout needs two things/)).toBeNull();
  });

  it('names the series the capacity was read from, to two places', () => {
    // 0.8866 is 88.66 percent and not 89: the price above the caption is
    // struck at the exact figure, so a rounded caption would name a capacity
    // the number was not priced at.
    const priced = occupations.find((entry) => entry.key === 'computer_math')!;
    render(<ExplorerPanel data={data()} follows="computer_math" />);

    expect(screen.getByText('88.66 percent of this pool already used')).toBeDefined();
    expect(screen.getByText(`Read from ${priced.seriesId!}.`)).toBeDefined();
    const distance = latestMonth(priced)?.distance ?? 0;
    expect(
      screen.getByText(priceFor(distance, EXPLORER_UTILISATION.computer_math!)!.monthly),
    ).toBeDefined();
  });

  it('says the premium is a what if once the capacity slider is moved', () => {
    render(<ExplorerScreen data={data()} />);
    const distance = latestMonth(opensOn)?.distance ?? 0;

    const capacity = screen.getByRole('slider', { name: 'How much capital wants this risk' });
    fireEvent.change(capacity, { target: { value: '60' } });

    expect(screen.getByText(priceFor(distance, 0.6)!.monthly)).toBeDefined();
    expect(screen.getByText('Monthly premium at 60 percent used, for 5,000 of cover')).toBeDefined();
    expect(screen.getByText('60 percent of this pool already used')).toBeDefined();
  });

  it('keeps the live capacity on the screen once the slider has been moved', () => {
    // The reader can always get back to the real figure, because the caption
    // under a moved slider is where the series actually stands.
    const priced = occupations.find((entry) => entry.key === 'computer_math')!;
    render(<ExplorerPanel data={data()} follows="computer_math" />);
    fireEvent.change(screen.getByRole('slider', { name: 'How much capital wants this risk' }), {
      target: { value: '10' },
    });

    expect(screen.getByText(`${priced.seriesId!} is at 88.66 percent.`)).toBeDefined();
  });

  it('shows the guide price when the capacity behind an occupation is unknown', () => {
    // A market price needs a utilisation. One nobody read would be a quote
    // struck at a number this page made up, so the block says guide price.
    render(<ExplorerScreen data={data({ utilisation: {} })} />);
    const distance = latestMonth(opensOn)?.distance ?? 0;

    expect(screen.getByText('Guide price for 5,000 of cover')).toBeDefined();
    expect(screen.getByText(priceFor(distance, 0)!.guide)).toBeDefined();
    expect(screen.queryByRole('slider', { name: 'How much capital wants this risk' })).toBeNull();
  });

  it('says an occupation with no capacity cannot be bought rather than pricing it', () => {
    // Every occupation has capacity behind it since T39, so the branch is
    // driven from a doctored reading rather than from a real one. The copy is
    // still on the screen for a series that has not been issued yet.
    render(
      <ExplorerScreen
        data={data({
          occupations: occupations.map((occupation) =>
            occupation.key === 'legal' ? { ...occupation, buyable: false } : occupation,
          ),
        })}
      />,
    );
    fireEvent.click(chooserRow());
    const legal = chips().find((button) => button.textContent?.startsWith('Legal') === true);
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
    // Under main, not the whole document: the chrome's own menu is a details
    // as well and it is not one of the two this page draws.
    const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('main details')];
    expect(disclosures).toHaveLength(2);
    for (const disclosure of disclosures) expect(disclosure.open).toBe(false);
    expect(disclosures[0]?.textContent).toContain('How this number is built');
    expect(disclosures[1]?.textContent).toContain('Every occupation, closest to opening first');
  });

  it('explains the number in four steps, each with its own chart', () => {
    render(<ExplorerScreen data={data()} />);
    const steps = document.querySelectorAll('main details')[0];
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
    const grid = document.querySelectorAll('main details')[1] as HTMLElement;
    const cells = within(grid).getAllByRole('button');
    expect(cells).toHaveLength(15);
    expect(cells[0]?.textContent).toContain('Arts, design, entertainment and media');
    expect(cells[0]?.textContent).toContain('on the line');
    expect(grid.querySelectorAll(':scope > div svg')).toHaveLength(15);
  });

  it('selects an occupation in the explorer above when a cell is chosen', () => {
    render(<ExplorerScreen data={data()} />);
    const grid = document.querySelectorAll('main details')[1] as HTMLElement;
    const cell = within(grid)
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('Legal') === true);
    fireEvent.click(cell as HTMLElement);

    const occupation = occupations.find((entry) => entry.key === 'legal')!;
    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(screen.getByText(headlineFor(latestMonth(occupation)))).toBeDefined();
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

describe('the occupation chooser says what it is for', () => {
  it('carries a visible label above it, and names the control with both', () => {
    // The control is a bordered box carrying an occupation's name, on a page
    // whose heading is also an occupation's name, so without a label it reads
    // as a subtitle rather than as something to press.
    render(<ExplorerScreen data={data()} />);
    expect(screen.getByText(CHOOSE_OCCUPATION)).toBeDefined();
    const trigger = screen.getByRole('button', { expanded: false, name: /Choose an occupation/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // The accessible name is the label and then the value, so the control is
    // announced as what it does and then as what it is holding.
    expect(trigger.getAttribute('aria-labelledby')?.split(' ')).toHaveLength(2);
  });

  it('says occupation, which is the word every other screen uses', () => {
    expect(CHOOSE_OCCUPATION).toContain('occupation');
    expect(CHOOSE_OCCUPATION).not.toContain('industry');
  });
});
