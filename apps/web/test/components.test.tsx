import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CoverCard } from '../src/components/cover-card.js';
import type { CardTreatment } from '../src/lib/font-option.js';

import { Gallery } from '../src/app/gallery/gallery.js';
import { LandingScreen } from '../src/components/landing/landing-screen.js';
import { PillButton } from '../src/components/pill-button.js';
import { StatusPill } from '../src/components/status-pill.js';
import { TabBar } from '../src/components/tab-bar.js';

import { LIVE } from './landing-fixtures.js';

/** Everything a person reads, with the markup taken out. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the pill button keeps its width while loading', () => {
  const label = 'Pay 28.00';
  const idle = renderToStaticMarkup(<PillButton>{label}</PillButton>);
  const busy = renderToStaticMarkup(<PillButton loading>{label}</PillButton>);

  // jsdom does not lay out, so a measured width would be zero in both states
  // and would prove nothing. The width is identical by construction instead:
  // the label stays in the flow and only its visibility changes, and the dots
  // are painted over it out of the flow. These assertions check that
  // construction, which is the thing that could regress.
  it('keeps the same label in the flow in both states', () => {
    expect(visibleText(idle)).toContain(label);
    expect(busy).toContain(label);
  });

  it('hides the label rather than removing it', () => {
    expect(busy).toMatch(/<span class="invisible">Pay 28\.00<\/span>/);
    expect(idle).toMatch(/<span>Pay 28\.00<\/span>/);
  });

  it('paints the dots out of the flow, so they add no width', () => {
    const dots = /<span class="([^"]*)" data-testid="pill-button-loading-dots"/.exec(busy)?.[1];
    expect(dots).toContain('absolute');
    expect(dots).toContain('inset-0');
  });

  it('shows the loading state to a screen reader without changing the label', () => {
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('Working');
  });
});

describe('state colours are indicators, not text', () => {
  it('puts the state colour on the dot and the label in ink', () => {
    for (const [state, colour] of [
      ['covered', 'bg-covered'],
      ['watch', 'bg-watch'],
      ['triggered', 'bg-triggered'],
    ] as const) {
      const markup = renderToStaticMarkup(<StatusPill state={state}>Covered</StatusPill>);
      expect(markup).toContain(colour);
      expect(markup).toContain('text-ink');
      expect(markup).not.toContain(`text-${state}`);
    }
  });

  it('drops the dot and uses ink-2 for the no-state variant', () => {
    const markup = renderToStaticMarkup(<StatusPill state="none">Cover ended</StatusPill>);
    expect(markup).toContain('text-ink-2');
    expect(markup).not.toContain('rounded-full bg-');
  });

  it('gives the inactive tab label ink-2 rather than ink-3', () => {
    const markup = renderToStaticMarkup(<TabBar active="cover" />);
    expect(markup).toContain('text-ink-2');
    expect(markup).not.toContain('text-ink-3');
  });
});

describe('the three home card directions', () => {
  const TREATMENTS: CardTreatment[] = ['wallet', 'certificate', 'ingot'];

  function render(treatment: CardTreatment): string {
    return renderToStaticMarkup(
      <CoverCard
        amount="5,000"
        occupation="Office and administrative support"
        state="covered"
        statusLabel="Covered"
        treatment={treatment}
      />,
    );
  }

  it('defaults to 1a, the direction the token sheet already carries', () => {
    const fallback = renderToStaticMarkup(
      <CoverCard
        amount="5,000"
        occupation="Office and administrative support"
        state="covered"
        statusLabel="Covered"
      />,
    );
    expect(fallback).toBe(render('wallet'));
    expect(fallback).not.toContain('cover-card--');
  });

  it('changes no copy between the three', () => {
    // Where a word sits is the treatment; which words there are is the copy.
    // The certificate centres the amount and drops the visible "Cover" label,
    // so the words arrive in a different order, but not one of them changes.
    // The label stays in the markup for a screen reader so this holds.
    const words = TREATMENTS.map((treatment) =>
      visibleText(render(treatment)).split(' ').sort().join(' '),
    );
    expect(words[1]).toBe(words[0]);
    expect(words[2]).toBe(words[0]);
    for (const phrase of ['Office and administrative support', 'Cover', '5,000', 'Covered']) {
      for (const treatment of TREATMENTS) {
        expect(visibleText(render(treatment))).toContain(phrase);
      }
    }
  });

  it('names each direction with its own modifier and leaves the base rule alone', () => {
    expect(render('certificate')).toContain('cover-card--certificate');
    expect(render('ingot')).toContain('cover-card--ingot');
    for (const treatment of TREATMENTS) {
      const markup = render(treatment);
      expect(markup).toContain('class="cover-card');
      expect(markup).toContain('cover-card__content');
    }
  });

  it('keeps every label in ink, because ink-2 fails on all three grounds', () => {
    for (const treatment of TREATMENTS) {
      expect(render(treatment)).not.toContain('text-ink-2');
    }
  });

  it('keeps the amount on the sheet scale and moves only its weight', () => {
    for (const treatment of TREATMENTS) {
      expect(render(treatment)).toContain('text-display-l font-display');
    }
    expect(render('certificate')).toContain('font-display font-medium tracking-display');
    expect(render('wallet')).toContain('font-display font-semibold tracking-display');
    expect(render('ingot')).toContain('font-display font-semibold tracking-display');
  });

  it('adds no spacing outside the card', () => {
    for (const treatment of TREATMENTS) {
      const outer = /^<div class="([^"]*)"/.exec(render(treatment))?.[1];
      expect(outer).toContain('p-5');
      expect(outer).not.toMatch(/\bm[trblxy]?-/);
    }
  });
});

describe('the gallery', () => {
  const markup = renderToStaticMarkup(<Gallery />);

  it('renders every component group', () => {
    for (const id of [
      'tokens',
      'pill-button',
      'text-link',
      'list-row',
      'surface-group',
      'bottom-sheet',
      'display-number',
      'amount-slider',
      'status-pill',
      'tab-bar',
      'toast',
      'form-field',
      'table',
      'index-chart-small',
      'index-chart-large',
      'cover-card',
      'home-directions',
      'upload',
      'checkbox',
      'segmented',
      'copy',
      'skeleton',
      'replay',
      'wallet',
      'frame',
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it('prints every token with both computed ratios', () => {
    const text = visibleText(markup);
    for (const token of ['canvas', 'surface', 'hairline', 'ink', 'ink-2', 'ink-3', 'covered', 'watch', 'triggered']) {
      expect(text).toContain(token);
    }
    expect(text).toContain('on canvas 5.05:1');
    expect(text).toContain('on surface 4.63:1');
    expect(text).toContain('on canvas 2.41:1 (below the text floor)');
  });

  it('has one h1 and a heading per section', () => {
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect((markup.match(/<h2/g) ?? []).length).toBeGreaterThan(20);
  });

  it('never leaves a border utility without a colour, which in v4 paints black', () => {
    const palette = /^border-(hairline|ink|ink-2|ink-3|canvas|surface|covered|watch|triggered|transparent|white)$/;
    for (const match of markup.matchAll(/class="([^"]*)"/g)) {
      const classes = (match[1] ?? '').split(/\s+/);
      const hasEdge = classes.some((name) => /^border(-[trblxy])?(-\d+)?$/.test(name));
      if (!hasEdge) continue;
      expect(classes.some((name) => palette.test(name))).toBe(true);
    }
  });

  it('renders the same markup at any viewport, and switches layout in CSS', () => {
    // The 390 and 1280 layouts are the same DOM: the gallery is responsive in
    // CSS, not in JavaScript, so there is nothing for a width to change here.
    // The breakpoint that produces the two layouts is asserted instead, and the
    // two widths are captured as screenshots in the run-through.
    expect(markup).toContain('sm:grid-cols-2');
    expect(markup).toContain('sm:px-16');
    expect(markup).toContain('max-w-[390px]');
    expect(markup).toContain('max-w-[1280px]');
  });

  it('is a stable snapshot', () => {
    expect(markup).toMatchSnapshot();
  });
});

describe('no em dash, no en dash and no percent glyph in anything rendered', () => {
  const screens: [string, string][] = [
    ['gallery', renderToStaticMarkup(<Gallery />)],
    ['landing', renderToStaticMarkup(<LandingScreen data={LIVE} />)],
  ];

  for (const [name, markup] of screens) {
    it(`is clean on ${name}`, () => {
      const text = visibleText(markup);
      expect(text).not.toContain('—');
      expect(text).not.toContain('–');
      expect(text).not.toContain('%');
    });
  }

  it('sweeps the text a person reads, not the attributes', () => {
    // The slider's fill is an inline custom property in per cent, which is CSS
    // and not copy. The sweep runs on text content so it does not confuse the
    // two, and this asserts the distinction holds.
    const markup = screens[0]?.[1] ?? '';
    expect(markup).toContain('%');
    expect(visibleText(markup)).not.toContain('%');
  });
});
