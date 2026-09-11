import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AttributionPanel } from '../src/components/attribution-panel.js';
import type { AttributionView } from '../src/lib/attribution-api.js';
import {
  ATTRIBUTION_DISCLOSURES,
  ATTRIBUTION_FALLBACK_NOTE,
  attributionPanel,
  attributionSnapshot,
} from '../src/lib/attribution-model.js';

/// The attribution panel: the figures it computes and the words it prints.
///
/// Most of this file is about what must not appear. The category of employer
/// attributed AI job cuts began in May 2023, so any month before it is
/// untracked and drawing a zero for one would be a fabricated data point on a
/// panel whose whole purpose is honesty about its own limits. And the panel
/// decides nothing: the settlement sentence has to be visible text, not a
/// footnote and not screen reader text, because a reader who takes one thing
/// away must take that one.

function visibleText(markup: string): string {
  return markup
    .replace(/<p class="sr-only">.*?<\/p>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const SNAPSHOT = attributionSnapshot();
const LIVE = attributionPanel(SNAPSHOT, { indexLatestPeriod: '2026-07' });
const live = visibleText(renderToStaticMarkup(<AttributionPanel data={LIVE} />));

describe('the figures', () => {
  it('adds the tracked months up to the published cumulative', () => {
    expect(LIVE.cumulative).toBe('188,000');
    expect(LIVE.latestMonth).toBe('August 2026');
    expect(LIVE.latestCuts).toBe('3,462');
    expect(LIVE.firstMonth).toBe('May 2023');
  });

  it('draws one bar per tracked month and no bar for anything else', () => {
    expect(LIVE.bars).toHaveLength(40);
    expect(LIVE.bars[0]?.period).toBe('2023-05');
    expect(LIVE.bars.at(-1)?.period).toBe('2026-08');
    expect(LIVE.bars.every((bar) => bar.period >= '2023-05')).toBe(true);
  });

  it('gives a recorded zero no bar and every other month at least one pixel', () => {
    const zeros = LIVE.bars.filter((bar) => bar.cuts === 0);
    expect(zeros).toHaveLength(15);
    expect(zeros.every((bar) => bar.height === 0)).toBe(true);
    // 2023-06 is 7 cuts against a peak of 38,579. Rounded to scale it is
    // nothing, and nothing is what a zero looks like, so it gets a pixel.
    expect(LIVE.bars.find((bar) => bar.period === '2023-06')?.height).toBe(1);
    expect(LIVE.bars.every((bar) => (bar.cuts === 0) === (bar.height === 0))).toBe(true);
  });

  it('scales the peak month to the full strip', () => {
    const peak = LIVE.bars.find((bar) => bar.period === '2026-05');
    expect(peak?.cuts).toBe(38579);
    expect(peak?.height).toBe(40);
  });

  it('says the index and this series are not aligned month for month', () => {
    expect(LIVE.alignmentNote).toContain('July 2026');
    expect(LIVE.alignmentNote).toContain('August 2026');
    expect(LIVE.alignmentNote).toContain('not aligned month for month');
  });

  it('drops the alignment note when the two do land on the same month', () => {
    expect(attributionPanel(SNAPSHOT, { indexLatestPeriod: '2026-08' }).alignmentNote).toBeNull();
  });
});

describe('the panel on the page', () => {
  it('says that it does not decide a payout, in body copy', () => {
    expect(live).toContain(
      'This does not affect settlement. Claims open on the occupation index alone, and nothing in this panel can open or close a claim.',
    );
    // Not screen reader text and not a footnote glyph: the sentence above was
    // taken from the markup with the sr-only paragraphs stripped out.
    expect(live).toContain('The index cannot tell why anyone lost their job.');
  });

  it('carries the four limits from the provenance in plain language', () => {
    expect(live).toContain('Employers report the reason themselves, and economists contest it.');
    expect(live).toContain('These are announced cuts, not separations.');
    expect(live).toContain('It is not coded by occupation');
    expect(live).toContain('New York added an artificial intelligence box');
    expect(live).toContain('Zero of the 162 or more filings since have ticked it.');
  });

  it('states the measured relationship with both figures and the shared trend', () => {
    expect(live).toContain('about minus 0.44 in levels');
    expect(live).toContain('about minus 0.21 differenced');
    expect(live).toContain('For construction and for farming, fishing and forestry it is about zero.');
    expect(live).toContain('Most of that level relationship is a shared trend');
    expect(live).toContain('It is context, not a predictor.');
  });

  // T56. The two blocks ship verbatim: the bold lead and every paragraph as
  // written, on both pages the panel is rendered on.
  it('carries the two disclosures verbatim, lead and paragraphs', () => {
    expect(ATTRIBUTION_DISCLOSURES).toHaveLength(2);
    const [twenties, exposure] = ATTRIBUTION_DISCLOSURES;
    expect(twenties?.lead).toBe(
      'The clearest evidence that AI is costing anyone work is about people in their early twenties.',
    );
    expect(twenties?.paragraphs).toEqual([
      'Payroll records covering millions of workers show employment for twenty two to twenty five year olds in AI exposed jobs running about nineteen percent below where it would otherwise be, and the gap is still widening. Workers with more experience show no comparable gap. The effect comes from companies hiring fewer people, not from companies letting people go.',
      'Two things follow, and both matter if you are deciding whether to buy this.',
      'If you are mid career, the best evidence available says your age group is not currently showing this effect.',
      'And the government data this cover settles on counts unemployment by occupation with no breakdown by age. So it could not detect that effect even if it did reach you.',
    ]);
    expect(exposure?.lead).toBe(
      'Exposure scores do predict who ends up unemployed, but only when you can look at individual occupations one by one.',
    );
    expect(exposure?.paragraphs).toEqual([
      'This cover settles on fifteen broad occupation groups. At that width the relationship runs the wrong way. On the same government survey this cover settles on, unemployment between 2022 and early 2025 rose by 0.30 points in the most AI exposed fifth of jobs and by 0.94 points in the least exposed fifth. Three times as much in the jobs supposedly least at risk.',
      'That is why no exposure score touches the price here, and none of it touches the payout.',
    ]);
    for (const block of ATTRIBUTION_DISCLOSURES) {
      expect(live).toContain(block.lead);
      for (const paragraph of block.paragraphs) expect(live).toContain(paragraph);
    }
  });

  it('sets each disclosure lead in bold, as the source text does', () => {
    const markup = renderToStaticMarkup(<AttributionPanel data={LIVE} />);
    for (const block of ATTRIBUTION_DISCLOSURES) {
      expect(markup).toContain(`<p class="font-medium text-ink">${block.lead}</p>`);
    }
  });

  it('says the category began in May 2023 and that earlier months are untracked', () => {
    expect(live).toContain('The category did not exist before May 2023');
    expect(live).toContain('earlier months are untracked and nothing is drawn for them');
    expect(live).toContain('15 of the 40 months here are');
  });

  it('names no month before the category existed', () => {
    // The two T56 disclosures quote a different survey's window, 2022 to
    // early 2025, verbatim. The guard is about the strip and its notes, so
    // the disclosures are taken out of the text before it is checked.
    const strip = ATTRIBUTION_DISCLOSURES.reduce(
      (text, block) => [block.lead, ...block.paragraphs].reduce((t, p) => t.replace(p, ''), text),
      live,
    );
    for (const month of ['2023-04', '2023-01', '2022', 'April 2023', 'Apr 2023', 'Dec 2022']) {
      expect(strip, `the panel must not name ${month}`).not.toContain(month);
    }
  });

  it('shows the cumulative and the most recent month', () => {
    expect(live).toContain('188,000');
    expect(live).toContain('Announced cuts since May 2023 where the employer named AI.');
    expect(live).toContain('In August 2026, 3,462.');
  });

  it('says nothing about a fallback while the feed is answering', () => {
    expect(live).not.toContain(ATTRIBUTION_FALLBACK_NOTE);
  });
});

describe('when the feed cannot be reached', () => {
  const cold = visibleText(
    renderToStaticMarkup(
      <AttributionPanel
        data={attributionPanel(SNAPSHOT, { indexLatestPeriod: '2026-07', fromSnapshot: true })}
      />,
    ),
  );

  it('shows the last published figures and says they are not a live read', () => {
    expect(cold).toContain('188,000');
    expect(cold).toContain('In August 2026, 3,462.');
    expect(cold).toContain(ATTRIBUTION_FALLBACK_NOTE);
    expect(cold).toContain('The feed could not be reached, so this is not a live read.');
  });

  it('keeps every caveat, because a failed read may cost a figure but not a limit', () => {
    expect(cold).toContain('These are announced cuts, not separations.');
    expect(cold).toContain('This does not affect settlement.');
    expect(cold).toContain('about minus 0.44 in levels');
    expect(cold).toContain('That is why no exposure score touches the price here');
  });
});

describe('the committed snapshot', () => {
  it('is the same series the feed serves', () => {
    const view: AttributionView = SNAPSHOT;
    expect(view.months).toHaveLength(40);
    expect(view.first_period).toBe('2023-05');
    expect(view.latest_period).toBe('2026-08');
    expect(view.cumulative).toBe(188000);
    expect(view.latest).toEqual({ period: '2026-08', cuts: 3462 });
    expect(view.peak).toEqual({ period: '2026-05', cuts: 38579 });
  });

  it('has no month before the category existed', () => {
    expect(SNAPSHOT.months.some((month) => month.period < '2023-05')).toBe(false);
  });
});
