import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingScreen } from '../src/components/landing/landing-screen.js';
import {
  explorerOccupation,
  headlineFor,
  latestMonth,
  rankByDistance,
} from '../src/lib/explorer-model.js';
import { AMOUNT_MIN } from '../src/lib/cover-amount.js';
import {
  INDEX_HISTORY_FROM,
  LANDING_GROUP,
  fromPriceBuys,
  fromPriceLine,
  historyFigure,
  historyYears,
  indexBadge,
  investorLine,
  landingIndexSection,
  noteFigures,
  payAnswer,
  staleNote,
  tickerReadings,
} from '../src/lib/landing-model.js';
import { OCCUPATIONS, findOccupation, hasCover, occupationLabel } from '../src/lib/occupations.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';
import { COUPONS, SERIES } from './investor-fixtures.js';
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
  it('runs header, hero, the question, index, closing, investor line', () => {
    const found = positions(visibleText(live), [
      // nav
      'Creance',
      'The index',
      'Earn yield',
      // hero
      'Cover for the day your job is automated.',
      'A monthly payment now. A payout if your occupation is displaced.',
      'From 4.25 a month',
      // hero card. One needle, because "Cover" on its own also matches the
      // first word of the hero headline.
      'Covered Cover 5,000',
      // the one question left in the ledger (T44)
      'When does it pay.',
      // the index section, which is the public explorer itself
      'Track if you are eligible to get paid',
      'Search occupations',
      'How this number is built',
      // the closing line, then the investor line
      'Be ready for whatever the future holds',
      'I want to invest',
      'Investors fund the cover and earn 8 percent a year, paid monthly.',
      // The footer bar is no longer this page's: since T50 the root layout
      // puts the product's one footer, with "How the index works" in it, under
      // every route, so it is asserted in site-chrome.test.tsx instead.
    ]);
    expect(found).toStrictEqual([...found].sort((a, b) => a - b));
  });

  it('opens the explorer on the occupation nearest its line, and names the page\'s own', () => {
    // The hero card speaks for LANDING_GROUP, and the explorer under it opens
    // on the occupation closest to a payout, which is the one a reader has
    // come to look at. Both are named on the page; only the second is the
    // panel's opening round.
    const text = visibleText(live);
    const opened = rankByDistance(EXPLORER_READINGS.map(explorerOccupation))[0];
    expect(text).toContain(occupationLabel(LANDING_GROUP));
    expect(text).toContain(opened?.occupation.label);
    expect(text).toContain(headlineFor(latestMonth(opened!.occupation)));
  });
});

describe('the words this page cut', () => {
  const text = visibleText(live);

  // The steps described the flow in three sentences. T35 puts the flow itself
  // on this page, so the description of it goes rather than being reworded.
  for (const cut of [
    'Two minutes, start to covered.',
    'Pick your occupation',
    'Eleven groups, one tap. Each shows its index reading.',
    'Choose your cover',
    '1,000 to 10,000. The monthly payment updates as you slide.',
    'One person, one cover, verified with World ID.',
    // T44. The hero prints the from price above this ledger and the hero card
    // wears the green "Covered" pill beside it, so both answers were the page
    // explaining what it was already showing.
    "The price comes from your occupation's index, nothing else.",
    'What does it cost.',
    'Your card says so at all times. Green means yes.',
    'Am I covered.',
  ]) {
    it(`no longer says "${cut}"`, () => {
      expect(text).not.toContain(cut);
    });
  }

  it('no longer explains the index in its own words, because it shows it', () => {
    expect(text).not.toContain(
      'Unemployment in your occupation, compared with everyone, smoothed over three months',
    );
  });

  it('keeps the strings it kept exactly as they were', () => {
    // Copy is cut, never rewritten. What is left is the deck's own sentences.
    expect(text).toContain('Cover for the day your job is automated.');
    expect(text).toContain('A monthly payment now. A payout if your occupation is displaced.');
    expect(text).toContain('Track if you are eligible to get paid');
    expect(text).toContain('Be ready for whatever the future holds');
  });
});

describe('the figures come from the feed and never from the page', () => {
  it('names both triggers, both levels and the occupation they are for', () => {
    expect(
      payAnswer(
        INDEX.trigger.attachment_shock,
        INDEX.trigger.level_line,
        LANDING_GROUP,
        INDEX.series_id,
      ),
    ).toBe(
      'Claims open in two ways for computer and mathematical: a sudden jump of 2 points above trend, or staying within 0.68 points of average. A jump of 4 pays in full.',
    );
  });

  it('drops the full payout sentence for a series with no published exhaustion', () => {
    expect(payAnswer('2.00', '-0.68', LANDING_GROUP, 'ODI-OFFICE-2026-01')).toBe(
      'Claims open in two ways for computer and mathematical: a sudden jump of 2 points above trend, or staying within 0.68 points of average.',
    );
  });

  it('says a positive level line as points worse than average', () => {
    expect(payAnswer('3.00', '1.32', 'arts_design_ent_media', null)).toContain(
      'staying 1.32 points worse than average',
    );
  });

  it('says the levels are not shown rather than remembering them', () => {
    const answer = payAnswer(null, null, LANDING_GROUP, null);
    expect(answer).toContain('The live feed is not answering');
    expect(answer).not.toMatch(/\d/);
  });

  it('names the price only when a quote produced one', () => {
    expect(fromPriceLine('4.25')).toBe('From 4.25 a month');
    expect(fromPriceLine(null)).toBeNull();
  });

  it('prints the from price once, in the hero', () => {
    const text = visibleText(live);
    expect(text.indexOf('From 4.25 a month')).toBeGreaterThan(-1);
    expect(text.indexOf('From 4.25 a month')).toBe(text.lastIndexOf('From 4.25 a month'));
  });

  it('says what the from price buys, from the cover the quote was for', () => {
    // T52. The second line is a figure, not copy: it names the cover the
    // quote was asked for, in the explorer's own wording, and it is built by
    // the model from that amount rather than typed anywhere.
    expect(fromPriceBuys(1000)).toBe('for 1,000 of cover');
    expect(visibleText(live)).toContain('From 4.25 a month for 1,000 of cover');
    expect(LIVE.price.buysLine).toBe(fromPriceBuys(AMOUNT_MIN));
  });

  it('gives the price the weight of a figure, before the action it argues for', () => {
    // The headline scale in white, not body type at the secondary opacity
    // under the buttons, and read before "Get a quote" rather than after it.
    const figure = /<p class="[^"]*"><span class="([^"]*)">From 4\.25 a month<\/span>/.exec(live);
    expect(figure?.[1]).toContain('text-headline');
    expect(figure?.[1]).toContain('text-white');
    expect(figure?.[1]).not.toContain('text-white/66');
    const hero = /<h1[\s\S]*?<\/section>/.exec(live)?.[0] ?? '';
    expect(hero.indexOf('From 4.25 a month')).toBeLessThan(hero.indexOf('Get a quote'));
  });

  it('leaves both lines out, and no space for them, when nothing was quoted', () => {
    const unpriced = renderToStaticMarkup(
      <LandingScreen data={{ ...LIVE, price: { priceLine: null, buysLine: null } }} />,
    );
    const hero = /<h1[\s\S]*?<\/section>/.exec(unpriced)?.[0] ?? '';
    const text = visibleText(hero);
    expect(text).not.toContain('From ');
    expect(text).not.toContain('of cover');
    expect(hero).not.toContain('data-testid="landing-resting"');
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

  it('says the metered reading is the last one, and still shows the round it has', () => {
    // The explorer's round is bought once every ten minutes and can be warm
    // while a fresh metered read fails. The page says so and keeps the round.
    const text = visibleText(stale);
    expect(text).toContain(staleNote('2026-07'));
    expect(text).toContain('This is the last reading we published, for July 2026.');
    expect(stale).toContain('data-testid="explorer-chart-line"');
  });

  it('shows the note and no figure when nothing has ever been published here', () => {
    const text = visibleText(cold);
    expect(text).toContain('The live feed is not answering, so there is no reading to show.');
    expect(COLD.explorer.round).toBeNull();
    // No chart, no reading, and above all no zero standing in for one.
    expect(cold).not.toContain('data-testid="explorer-chart-line"');
    expect(text).not.toContain('0.00');
  });

  it('says nothing is published rather than blaming a feed that answered', () => {
    // A group the index has no month for comes back with a null headline from a
    // working endpoint. Calling that an outage would be false.
    const unpublished = { ...INDEX, group: LANDING_GROUP, headline: null };
    const section = landingIndexSection(unpublished, true);
    expect(section.note).toBe('No reading has been published for this occupation yet.');
    expect(section.note).not.toContain('not answering');
  });

  it('blames the feed only when the feed is what failed', () => {
    expect(landingIndexSection(null, false).note).toBe(
      'The live feed is not answering, so there is no reading to show.',
    );
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
  it('is the header and the main, and never the body', () => {
    // T50 counted three bands: the header, the hero with the ticker, and the
    // closing line. Since T52 the main itself is the night ground and the
    // light sections are a sheet laid on it, so the page carries the class
    // twice, on the header and on the main, and a third time on the panel the
    // header's menu opens, which is the band continuing down the screen. The
    // page root is still canvas and so is the document, so no other route can
    // be darkened by this page.
    expect(live.match(/bg-night(?![-\w/])/g)).toHaveLength(3);
    expect(live).toContain('<main class="bg-night">');
    expect(live).toContain('flex flex-col bg-canvas');
  });

  it('raises nothing off the night ground', () => {
    // The addendum's raised ground was drawn for the chips T54 stood around
    // the card. They are gone, and nothing else on this page asks for it.
    expect(live).not.toContain('bg-night-2');
  });

  it('turns the focus outline white on both night bands', () => {
    // The stylesheet's one night rule reads data-tone (T52). The hero's pills
    // and chips and the closing band's pills stand on the night ground, so
    // both sections carry it; the sheet between them does not.
    const sections = [...live.matchAll(/<section[^>]*data-tone="night"/g)];
    expect(sections).toHaveLength(2);
    const sheet = /<div class="rounded-\[20px\] bg-canvas lg:rounded-hero">[\s\S]*?<\/div><section/.exec(live)?.[0] ?? '';
    expect(sheet).not.toContain('data-tone');
  });

  it('lays the light sections on it as one sheet with rounded corners', () => {
    // The boundary between the two grounds is a drawn edge, not a seam: the
    // question and the index sit in one canvas sheet inside the night main,
    // with the sheet's radius at 390 and the hero card's at the landing
    // breakpoint, and the closing line stands outside it on the night again.
    const sheet = /<div class="rounded-\[20px\] bg-canvas lg:rounded-hero">[\s\S]*?<\/div><section/.exec(live)?.[0] ?? '';
    expect(sheet).toContain('When does it pay.');
    expect(sheet).toContain('id="the-index"');
    expect(sheet).not.toContain('Be ready for whatever the future holds');
    expect(live.indexOf('landing-ticker')).toBeLessThan(live.indexOf('rounded-[20px] bg-canvas'));
    expect(live.match(/rounded-\[20px\] bg-canvas lg:rounded-hero/g)).toHaveLength(1);
  });

  it('writes headings in white and everything else at the addendum opacity', () => {
    const closing = /<section class="py-16 lg:py-28[^"]*"[^>]*>(?:(?!<\/section>)[\s\S])*Be ready for whatever the future holds[\s\S]*?<\/section>/.exec(live)?.[0] ?? '';
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
    for (const label of ['The index', 'Earn yield']) {
      const link = new RegExp(`<a[^>]*>${label}</a>`).exec(nav)?.[0] ?? '';
      expect(link, label).toContain('max-md:hidden');
    }
  });
});

describe('the ticker of occupation readings', () => {
  /** Every occupation label the strip prints, in the order it prints them. */
  const labels = [
    ...live.matchAll(/landing-ticker__item[^>]*><span class="font-medium text-white">([^<]+)</g),
  ].map((match) => match[1]);

  it('carries all fifteen groups twice, so the loop closes on itself', () => {
    expect(LIVE.explorer.ticker).toHaveLength(15);
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

  it('carries its separation on every item, which is what closes the loop', () => {
    // The stylesheet puts the 56px on the item rather than between items, so
    // half the row is exactly the distance from an item to its duplicate. Every
    // item has to carry the class or the period is wrong by part of a gap.
    expect(live.match(/landing-ticker__item/g)).toHaveLength(30);
  });

  it('is absent altogether when no reading could be bought', () => {
    const markup = renderToStaticMarkup(
      <LandingScreen data={{ ...LIVE, explorer: { ...LIVE.explorer, ticker: [] } }} />,
    );
    expect(markup).not.toContain('landing-ticker');
  });
});

describe('the public index explorer, on the front door', () => {
  it('is the explorer itself and not a second drawing of it', () => {
    // The landing renders ExplorerPanel, the component `/index` renders, with
    // the round `/index` bought. The picker, the trigger band, the four steps
    // and the guide price therefore behave here exactly as they do there,
    // because there is one of each and not two.
    const chips = [...live.matchAll(/aria-pressed="(true|false)"/g)];
    expect(chips).toHaveLength(15);
    expect(live).toContain('data-testid="explorer-chart-band"');
    expect(live).toContain('data-testid="explorer-meter"');
    const text = visibleText(live);
    expect(text).toContain('How this number is built');
    expect(text).toContain('Every occupation, closest to opening first');
    expect(text).toContain('Monthly premium for 5,000 of cover');
  });

  it('says where the same figures can be read without trusting the page', () => {
    expect(live).toContain(LIVE.explorer.round!.provenance.hashscan!);
    expect(visibleText(live)).toContain(LIVE.explorer.round!.provenance.source);
  });

  it('buys nothing of its own: the page shows the round the explorer bought', () => {
    // src/lib/landing-data.ts asks readExplorer for it, which holds one round
    // for ten minutes behind a single in-flight promise, and words the ticker
    // from the same fifteen readings rather than reading a sixteenth.
    expect(LIVE.explorer.round!.occupations).toHaveLength(15);
    expect(LIVE.explorer.ticker).toHaveLength(15);
  });
});

describe('the front of the machine', () => {
  it('offers the quote three times, as buttons rather than as a form post', () => {
    // The button opened /occupation through a server action and a redirect. The
    // quote is on this page now (T35), so it opens in place and nothing about
    // it posts.
    const buttons = [...live.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
      visibleText(match[1] ?? ''),
    );
    expect(buttons.filter((label) => label === 'Get a quote')).toHaveLength(3);
    // This used to read "no form on the page at all", which held while the
    // quote was the only thing on it that could post. The newsletter posts, on
    // purpose, so that it works before hydration the way the trading forms do.
    // What still has to be true is that it is the only one.
    const forms = [...live.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((match) => match[0]);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('type="email"');
  });

  it('stands the cover card in the hero until the quote is asked for', () => {
    expect(live).toContain('cover-card-stack');
    expect(live).not.toContain('data-testid="landing-quote"');
  });

  it('gives the index section the id the amount step opens', () => {
    // "How the index works" in the quote is this section and not another route,
    // because the occupation being quoted is the occupation it is showing.
    expect(live).toContain('id="the-index"');
  });
});

describe('the hero card as an object', () => {
  it('asks for depth here and in no other place in the product', () => {
    expect(live.match(/cover-card--depth/g)).toHaveLength(1);
    expect(live).toContain('cover-card-stack');
    expect(live).toContain('cover-card-tilt');
  });

  it('is the metal finish, once, and asks for it nowhere else', () => {
    expect(live.match(/cover-card--metal/g)).toHaveLength(1);
    expect(live.match(/cover-card__shimmer/g)).toHaveLength(1);
  });

  it('keeps the shimmer beneath the card content, like every other light layer', () => {
    const card = /<div class="cover-card [\s\S]*?cover-card__content/.exec(live)?.[0] ?? '';
    expect(card).toContain('cover-card__shimmer');
    expect(card.indexOf('cover-card__shimmer')).toBeLessThan(card.indexOf('cover-card__content'));
  });

  it('sits to the right of the hero text at 1440 and under it at 390', () => {
    // One grid, two columns above the landing breakpoint and one below it, so
    // the order in the markup is the order at 390: the text, then the card.
    const band = /<div class="mx-auto grid[^"]*"/.exec(live)?.[0] ?? '';
    expect(band).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)]');
    expect(live.indexOf('Cover for the day your job is automated.')).toBeLessThan(
      live.indexOf('cover-card-stack'),
    );
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
    expect(visibleText(live)).toContain(
      'Index live for 15 occupations, updated monthly from public data',
    );
    expect(LIVE.index.live).toBe(true);
  });

  it('says what it is showing instead when the feed did not answer', () => {
    const text = visibleText(renderToStaticMarkup(<LandingScreen data={STALE} />));
    expect(text).toContain('Showing the last reading we published');
    expect(text).not.toContain('Index live');
    expect(text).not.toContain('15 occupations');
    expect(STALE.index.live).toBe(false);
  });
});

describe('the figures band (T54)', () => {
  const band = /<div class="[^"]*" data-testid="landing-figures">[\s\S]*?<\/div>/.exec(live)?.[0] ?? '';

  it('carries the four figures the reads hold, with their labels, under the hero', () => {
    expect(visibleText(band)).toBe(
      '16 years of index history 3 coupons settled on Hedera 1,994.52 paid to noteholders 447,000 funding the cover',
    );
    expect(live.indexOf('cover-card-stack')).toBeLessThan(live.indexOf('data-testid="landing-figures"'));
    expect(live.indexOf('data-testid="landing-figures"')).toBeLessThan(live.indexOf('landing-ticker'));
  });

  it('writes the value in white at a display size and the label at the secondary opacity', () => {
    const figure = /<p class="flex flex-col gap-1"><span class="([^"]*)">16<\/span><span class="([^"]*)">/.exec(band);
    expect(figure?.[1]).toContain('text-white');
    expect(figure?.[1]).toContain('lg:text-display-l');
    expect(figure?.[2]).toContain('text-white/66');
  });

  it('is as wide as the truth: no note, no note figures, and no space kept for them', () => {
    const cold = renderToStaticMarkup(<LandingScreen data={COLD} />);
    const empty = /<div class="[^"]*" data-testid="landing-figures">([\s\S]*?)<\/div>/.exec(cold)?.[1] ?? '';
    expect(visibleText(empty)).toBe('');
    expect(empty).not.toContain('landing-resting');
  });
});

describe('the headline (T54)', () => {
  it('takes the landing headline size from 1280, at its tighter leading', () => {
    const h1 = /<h1 class="([^"]*)"/.exec(live)?.[1] ?? '';
    expect(h1).toContain('xl:text-landing-headline');
    expect(h1).toContain('xl:tracking-landing-hero');
    // Below that the column beside the card is narrower, and T34's size holds.
    expect(h1).toContain('lg:text-display-xl');
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
    for (const label of ['Get a quote', 'I want to invest', 'The index', 'Creance']) {
      expect(interactive, label).toContain(label);
    }
    expect(live).not.toContain('outline-none');
    expect(live).not.toContain('focus:outline');
  });

  it('sends the index link to the public explorer', () => {
    // There were two, the navigation's and the footer bar's. The footer is the
    // root layout's since T50, so what is left is the header's, which is in
    // the markup twice: the row at the desktop widths and the phone's menu.
    expect(live.match(/href="\/index"/g)).toHaveLength(2);
    expect(live).not.toContain('/cover/index');
    expect(live).toContain('href="/invest"');
  });
});

describe('the way in to the example (T50)', () => {
  const demo = renderToStaticMarkup(<LandingScreen data={LIVE} demo />);

  it('is in the hero, beside the quote, only where a demonstration exists', () => {
    expect(live).not.toContain('See an example of cover');
    expect(live).not.toContain('href="/home/demo"');
    const link = /<a[^>]*href="\/home\/demo"[^>]*>([\s\S]*?)<\/a>/.exec(demo);
    expect(visibleText(link?.[1] ?? '')).toBe('See an example of cover');
    // In the hero, after the price and the primary. The price stood after the
    // pills until T52 gave it weight and moved it above them, so the order in
    // the hero is now the figure, then the primary, then the example.
    const hero = /<h1[\s\S]*?<\/section>/.exec(demo)?.[0] ?? '';
    expect(hero).toContain('href="/home/demo"');
    expect(hero.indexOf('From 4.25 a month')).toBeLessThan(hero.indexOf('Get a quote'));
    expect(hero.indexOf('Get a quote')).toBeLessThan(hero.indexOf('href="/home/demo"'));
    expect(demo.match(/href="\/home\/demo"/g)).toHaveLength(1);
  });

  it('does not outrank the primary', () => {
    // The secondary pill on the night ground: a faint plate and a visible
    // edge, where the primary is the filled canvas pill. Neither is bg-ink,
    // which is invisible on this ground. The edge is white at 40 percent
    // rather than 24: over the night ground 24 composites to about 2.0:1,
    // which is not an edge a person can rely on finding.
    const link = /<a[^>]*href="\/home\/demo"[^>]*>/.exec(demo)?.[0] ?? '';
    expect(link).toContain('border-white/40');
    expect(link).toContain('bg-white/12');
    expect(link).not.toContain('bg-canvas');
  });

  it('adds one control and no other words', () => {
    // T44 set a word budget for this page; the control is four words and the
    // only thing the flag adds.
    const without = visibleText(demo).replace('See an example of cover ', '');
    expect(without).toBe(visibleText(live));
  });
});

describe('the figures under the hero are built from records, never typed', () => {
  it('counts the years of history from the month docs/INDEX.md starts the backtest', () => {
    const doc = readFileSync(new URL('../../../docs/INDEX.md', import.meta.url), 'utf8');
    expect(doc).toContain(`The backtest window on this page runs from ${INDEX_HISTORY_FROM}.`);
    expect(historyYears('2026-07')).toBe(16);
    expect(historyYears('2026-01')).toBe(16);
    expect(historyYears('2025-12')).toBe(15);
    expect(historyYears(null)).toBeNull();
    expect(historyYears('2009-06')).toBeNull();
    expect(historyFigure(INDEX.as_of)).toStrictEqual({ value: '16', label: 'years of index history' });
  });

  it('takes the band figures from the series and the coupons the API served', () => {
    // The principal is every occupation's, handed in by the caller, not this
    // note's. One series' principal under the label "funding the cover" read
    // as the product's capital and was 4.5 times short of it.
    expect(noteFigures(SERIES, COUPONS, 447_000_000_000n)).toStrictEqual([
      { value: '3', label: 'coupons settled on Hedera' },
      { value: '1,994.52', label: 'paid to noteholders' },
      { value: '447,000', label: 'funding the cover' },
    ]);
  });

  it('prints no nought for a note that has settled nothing', () => {
    const fresh = { ...SERIES, coupons: { ...SERIES.coupons, settled: 0 } };
    const figures = noteFigures(fresh, { ...COUPONS, coupons: [] }, 447_000_000_000n);
    expect(figures).toStrictEqual([{ value: '447,000', label: 'funding the cover' }]);
  });

  it('drops the principal rather than falling back to one series', () => {
    // A capacity read that failed used to leave this note's own principal
    // under a label that says every occupation's, which is the bug itself.
    expect(noteFigures(SERIES, COUPONS, null).map((figure) => figure.label)).toStrictEqual([
      'coupons settled on Hedera',
      'paid to noteholders',
    ]);
  });

  it('gives the badge its number only while the feed is live', () => {
    expect(OCCUPATIONS).toHaveLength(15);
    expect(indexBadge(true)).toBe(
      'Index live for 15 occupations, updated monthly from public data',
    );
    expect(indexBadge(false)).toBe('Showing the last reading we published');
    expect(indexBadge(false)).not.toMatch(/\d/);
  });
});
