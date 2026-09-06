import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingScreen } from '../src/components/landing/landing-screen.js';
import { explorerOccupation, rankByDistance } from '../src/lib/explorer-model.js';
import {
  LANDING_GROUP,
  costAnswer,
  fromPriceLine,
  investorLine,
  landingIndexSection,
  payAnswer,
  staleNote,
  tickerReadings,
} from '../src/lib/landing-model.js';
import { findOccupation, hasCover, occupationLabel } from '../src/lib/occupations.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';
import { COLD, LIVE, REPLAYING, STALE } from './landing-fixtures.js';
import { INDEX } from './worker-fixtures.js';

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where each of these strings first appears, so the order can be asserted. */
function positions(text: string, strings: readonly string[]): number[] {
  return strings.map((needle) => {
    const at = text.indexOf(needle);
    expect(at, `missing from the page: ${needle}`).toBeGreaterThan(-1);
    return at;
  });
}

const live = renderToStaticMarkup(<LandingScreen data={LIVE} />);

describe('the sections, in the order of the design of record', () => {
  it('runs nav, hero, questions, steps, index, closing, investor line, footer', () => {
    const found = positions(visibleText(live), [
      // nav
      'Creance',
      'The index',
      'Investors',
      // hero
      'Cover for the day your job is automated.',
      'A monthly payment now. A payout if your occupation is displaced.',
      'From 4.25 a month',
      // hero card. One needle, because "Cover" on its own also matches the
      // first word of the hero headline.
      'Covered Cover 5,000',
      // the three questions
      'What does it cost.',
      'When does it pay.',
      'Am I covered.',
      // the three steps
      'Two minutes, start to covered.',
      'Pick your occupation',
      'Choose your cover',
      'Verify and pay',
      // the index section
      'One number decides. You can watch it.',
      // the closing line, then the investor line
      'The quiet kind of ready.',
      'I want to invest',
      'Investors fund the cover and earn 8 percent a year, paid monthly.',
      // the footer bar
      'How the index works',
    ]);
    expect(found).toStrictEqual([...found].sort((a, b) => a - b));
  });

  it('says the index section sentence and the reading beside it', () => {
    const text = visibleText(live);
    expect(text).toContain(
      'Unemployment in your occupation, compared with everyone, smoothed over three months, compared with a year ago. No adjuster, no claim forms.',
    );
    expect(text).toContain('Computer and mathematical');
    expect(text).toContain(LIVE.index.reading!.distance);
    expect(text).toContain(LIVE.index.reading!.trend);
  });
});

describe('the three steps are verbatim', () => {
  const text = visibleText(live);

  for (const [title, line] of [
    ['Pick your occupation', 'Eleven groups, one tap. Each shows its index reading.'],
    ['Choose your cover', '1,000 to 10,000. The monthly payment updates as you slide.'],
    ["Verify and pay", "One person, one cover, verified with World ID. Pay and you're done."],
  ] as const) {
    it(`carries "${title}" with its own sentence`, () => {
      expect(text).toContain(title);
      expect(text).toContain(line);
    });
  }

  it('numbers them without asking a screen reader to read the numerals', () => {
    // The numerals are #C9CDD4 on surface, which is 1.4:1. They are decoration
    // over an ordered list, and the list is what carries the order.
    expect(live).toContain('<ol');
    expect(live).toMatch(/<span aria-hidden="true"[^>]*>1<\/span>/);
  });
});

describe('the figures come from the feed and never from the page', () => {
  it('interpolates the attachment and the full payout level', () => {
    expect(payAnswer(INDEX.trigger.attachment_shock, INDEX.series_id)).toBe(
      'When the index for your occupation rises 2 points above its trend. Full payout at 4.',
    );
  });

  it('drops the full payout sentence for a series with no published exhaustion', () => {
    expect(payAnswer('2.00', 'ODI-OFFICE-2026-01')).toBe(
      'When the index for your occupation rises 2 points above its trend.',
    );
  });

  it('says the level is not shown rather than remembering one', () => {
    const answer = payAnswer(null, null);
    expect(answer).toContain('The live feed is not answering');
    expect(answer).not.toMatch(/\d/);
  });

  it('names the price only when a quote produced one', () => {
    expect(fromPriceLine('4.25')).toBe('From 4.25 a month');
    expect(fromPriceLine(null)).toBeNull();
    expect(costAnswer('4.25')).toBe(
      "From 4.25 a month. The price comes from your occupation's index, nothing else.",
    );
    expect(costAnswer(null)).toBe("The price comes from your occupation's index, nothing else.");
  });

  it('falls back to the first landing wording rather than naming a rate it did not read', () => {
    expect(investorLine('8 percent a year, paid monthly')).toBe(
      'Investors fund the cover and earn 8 percent a year, paid monthly.',
    );
    expect(investorLine(null)).toBe('Investors fund the cover and earn the premiums monthly.');
  });

  it('speaks for an occupation that has a series behind it, so the card is true', () => {
    const occupation = findOccupation(LANDING_GROUP);
    expect(occupation).not.toBeNull();
    expect(hasCover(occupation!)).toBe(true);
  });
});

describe('the degraded index section', () => {
  const stale = renderToStaticMarkup(<LandingScreen data={STALE} />);
  const cold = renderToStaticMarkup(<LandingScreen data={COLD} />);

  it('says nothing extra while the feed answers', () => {
    expect(live).not.toContain('data-testid="landing-index-note"');
    expect(LIVE.index.note).toBeNull();
  });

  it('keeps the last published reading and says it is the last one', () => {
    const text = visibleText(stale);
    expect(text).toContain('0.69');
    expect(text).toContain(staleNote('2026-07'));
    expect(text).toContain('This is the last reading we published, for July 2026.');
  });

  it('shows the note and no figure when nothing has ever been published here', () => {
    const text = visibleText(cold);
    expect(text).toContain('The live feed is not answering, so there is no reading to show.');
    expect(COLD.index.reading).toBeNull();
    // No chart, no reading, and above all no zero standing in for one.
    expect(cold).not.toContain('data-testid="index-chart-line"');
    expect(text).not.toContain('0.00');
  });

  it('says nothing is published rather than blaming a feed that answered', () => {
    // A group the index has no month for comes back with a null headline from a
    // working endpoint. Calling that an outage would be false.
    const unpublished = { ...INDEX, group: LANDING_GROUP, headline: null };
    const section = landingIndexSection(LANDING_GROUP, unpublished, true);
    expect(section.reading).toBeNull();
    expect(section.note).toBe('No reading has been published for this occupation yet.');
    expect(section.note).not.toContain('not answering');
  });

  it('blames the feed only when the feed is what failed', () => {
    expect(landingIndexSection(LANDING_GROUP, null, false).note).toBe(
      'The live feed is not answering, so there is no reading to show.',
    );
  });

  it('never degrades to a zero, whichever way it degrades', () => {
    for (const markup of [stale, cold]) {
      expect(visibleText(markup)).not.toMatch(/\b0\.00\b/);
    }
    expect(landingIndexSection(LANDING_GROUP, null, false).reading).toBeNull();
  });
});

describe('the demo clock and the page', () => {
  it('carries the replay badge in the index section when the clock is walking', () => {
    const markup = renderToStaticMarkup(<LandingScreen data={REPLAYING} />);
    expect(visibleText(markup)).toContain('Replay: Jul 2026');
  });

  it('leaves the badge off when the clock is live', () => {
    // "Replay" on its own is in React's own form replay script, which is not
    // copy. The badge is the label, and the label is what must be absent.
    expect(visibleText(live)).not.toContain('Replay: ');
  });
});

describe('the dark marketing ground', () => {
  it('is three sections and never the body', () => {
    // The navigation, the hero with the card and the ticker, and the closing
    // line. The page root is still canvas and so is the document, so no other
    // route can be darkened by this page.
    expect(live.match(/bg-night/g)).toHaveLength(3);
    expect(live).toContain('flex flex-col bg-canvas');
  });

  it('leaves the sections between them exactly as they were', () => {
    // The steps keep the surface ground and the questions and the index section
    // keep the canvas one. Nothing between the two dark bands changed.
    expect(live).toContain('bg-surface');
    expect(live).not.toContain('bg-night-2');
  });

  it('writes headings in white and everything else at the addendum opacity', () => {
    const closing = /<section class="bg-night py-16[\s\S]*?<\/section>/.exec(live)?.[0] ?? '';
    expect(closing).toContain('text-white lg:text-display-xl');
    expect(closing).toContain('text-secondary text-white/66');
    expect(closing).not.toContain('text-ink-2');
  });
});

describe('the navigation on the dark ground', () => {
  const nav = /<header[\s\S]*?<\/header>/.exec(live)?.[0] ?? '';

  it('draws the call to action inverted, not in the colour of the ground', () => {
    // A primary pill is bg-ink, which is black on #0A0D12 and invisible. The
    // variant is what makes it legible; an override on top of bg-ink would be a
    // coin toss decided by the order two utilities happen to compile in.
    const button = /<button[^>]*>/.exec(nav)?.[0] ?? '';
    expect(button).toContain('bg-canvas');
    expect(button).toContain('text-ink');
    expect(button).not.toContain('bg-ink');
  });

  it('keeps the wordmark and the action on one line at 390', () => {
    expect(nav).not.toContain('flex-wrap');
    expect(nav).toContain('whitespace-nowrap text-body font-semibold text-white');
  });

  it('hides the secondary links below the medium breakpoint rather than wrapping', () => {
    for (const label of ['The index', 'Investors']) {
      const link = new RegExp(`<a[^>]*>${label}</a>`).exec(nav)?.[0] ?? '';
      expect(link, label).toContain('hidden md:inline-flex');
    }
  });
});

describe('the ticker of occupation readings', () => {
  /** Every occupation label the strip prints, in the order it prints them. */
  const labels = [...live.matchAll(/class="font-medium text-white">([^<]+)</g)].map(
    (match) => match[1],
  );

  it('carries all fifteen groups twice, so the loop closes on itself', () => {
    expect(LIVE.ticker).toHaveLength(15);
    expect(labels).toHaveLength(30);
    expect(labels.slice(0, 15)).toStrictEqual(labels.slice(15));
  });

  it('leads with the occupation this page speaks for, then the explorer order', () => {
    const occupations = EXPLORER_READINGS.map(explorerOccupation);
    const landing = occupationLabel(LANDING_GROUP);
    const ranked = rankByDistance(occupations).map((entry) => entry.occupation.label);
    expect(labels.slice(0, 15)).toStrictEqual([
      landing,
      ...ranked.filter((label) => label !== landing),
    ]);
  });

  it('says the distance in the words the explorer uses, not a second vocabulary', () => {
    const occupations = EXPLORER_READINGS.map(explorerOccupation);
    const ranked = rankByDistance(occupations);
    for (const reading of tickerReadings(occupations, LANDING_GROUP)) {
      const entry = ranked.find((row) => row.occupation.label === reading.occupation);
      expect(entry?.gap, reading.occupation).toBe(reading.gap);
    }
  });

  it('is hidden from assistive technology, because the same readings are /index', () => {
    expect(live).toContain('<div aria-hidden="true" class="landing-ticker');
  });

  it('is absent altogether when no reading could be bought', () => {
    const markup = renderToStaticMarkup(<LandingScreen data={{ ...LIVE, ticker: [] }} />);
    expect(markup).not.toContain('landing-ticker');
  });
});

describe('the hero card as an object', () => {
  it('asks for depth here and in no other place in the product', () => {
    expect(live.match(/cover-card--depth/g)).toHaveLength(1);
    expect(live).toContain('cover-card-stack');
    expect(live).toContain('cover-card-tilt');
  });

  it('paints its light layers beneath its content, in every treatment', () => {
    // The glare is a sibling of the face and precedes it, and the face is the
    // element the stylesheet lifts. The stylesheet test asserts the z-indexes.
    const card = /<div class="cover-card [\s\S]*?cover-card__content/.exec(live)?.[0] ?? '';
    expect(card).toContain('cover-card__glare');
    expect(card.indexOf('cover-card__glare')).toBeLessThan(card.indexOf('cover-card__content'));
  });

  it('prints the true cover amount in the server HTML, before anything animates', () => {
    // The count-up starts from this, not from zero. A browser that never runs
    // an animation still shows the figure.
    expect(visibleText(live)).toContain('Covered Cover 5,000');
  });
});

describe('the index live state', () => {
  it('says live when the feed answered on this request', () => {
    expect(visibleText(live)).toContain('Index live, updated monthly from public data');
    expect(LIVE.index.live).toBe(true);
  });

  it('says what it is showing instead when the feed did not answer', () => {
    const text = visibleText(renderToStaticMarkup(<LandingScreen data={STALE} />));
    expect(text).toContain('Showing the last reading we published');
    expect(text).not.toContain('Index live');
    expect(STALE.index.live).toBe(false);
  });
});

describe('motion and focus', () => {
  it('has one orchestrated moment on load and a reduced branch for every animation', () => {
    expect(live).toContain('cover-card-enter');
    expect(live.match(/cover-card-enter/g)).toHaveLength(1);
    // Two animations reach the markup: the card's entrance, which is the
    // orchestrated moment, and the ticker's travel, which is continuous. Each
    // carries its own reduced-motion branch and there is no third.
    expect(live.match(/motion-reduce:animate-none/g)).toHaveLength(2);
  });

  it('runs nothing on scroll', () => {
    expect(live).not.toContain('IntersectionObserver');
    expect(live).not.toContain('onScroll');
    expect(live).not.toMatch(/animate-(?!none)/);
  });

  it('makes every interactive element a button or an anchor, so the outline applies', () => {
    // The design draws the navigation, the pills and the footer links as divs
    // and spans, which have neither focus nor keyboard.
    const interactive = [...live.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((match) =>
      visibleText(match[2] ?? ''),
    );
    for (const label of ['Get a quote', 'I want to invest', 'The index', 'How the index works']) {
      expect(interactive, label).toContain(label);
    }
    expect(live).not.toContain('outline-none');
    expect(live).not.toContain('focus:outline');
  });

  it('sends the two index links to the public explorer', () => {
    expect(live.match(/href="\/index"/g)).toHaveLength(2);
    expect(live).not.toContain('/cover/index');
    expect(live).toContain('href="/invest"');
  });
});
