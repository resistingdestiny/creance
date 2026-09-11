import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CoverCard } from '../src/components/cover-card.js';
import type { CardTreatment } from '../src/lib/font-option.js';

import { Gallery } from '../src/app/gallery/gallery.js';
import { LandingScreen } from '../src/components/landing/landing-screen.js';
import { PillButton, PillLink, type PillButtonVariant } from '../src/components/pill-button.js';
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

/**
 * Three levels and no more, on both grounds.
 *
 * What is asserted here is the shape of the system rather than the hex of any
 * one button: that there are exactly six skins, that they are three ranks
 * twice, that a rank is told apart by its fill and its edge and never by its
 * size, and that the states the stylesheet owns are still the stylesheet's.
 * The point of the ticket was that the product had five unrelated button
 * treatments, so the thing worth holding is the count and the ladder.
 */
describe('the three button levels', () => {
  const LEVELS = ['primary', 'secondary', 'tertiary'] as const;
  const VARIANTS: PillButtonVariant[] = [
    'primary',
    'secondary',
    'tertiary',
    'night',
    'night-secondary',
    'night-tertiary',
  ];

  function classesOf(variant: PillButtonVariant, props: { disabled?: boolean } = {}): string[] {
    const markup = renderToStaticMarkup(
      <PillButton variant={variant} {...props}>
        Pay 28.00
      </PillButton>,
    );
    return (/<button class="([^"]*)"/.exec(markup)?.[1] ?? '').split(/\s+/);
  }

  /** Every class that is not shared by all six, which is the skin. */
  function skinOf(variant: PillButtonVariant): string[] {
    const all = VARIANTS.map((name) => new Set(classesOf(name)));
    return classesOf(variant).filter((name) => !all.every((set) => set.has(name)));
  }

  it('draws six skins, which is three ranks on the light ground and three on the night', () => {
    const skins = VARIANTS.map((variant) => skinOf(variant).sort().join(' '));
    expect(new Set(skins).size).toBe(6);
    for (const level of LEVELS) {
      const day = level;
      const night = level === 'primary' ? 'night' : `night-${level}`;
      expect(skinOf(day as PillButtonVariant)).not.toStrictEqual(
        skinOf(night as PillButtonVariant),
      );
    }
  });

  it('separates the ranks by fill and edge, never by size', () => {
    // A screen has to be able to swap a level for another without the row
    // moving, which is why the transparent ones still carry `border`.
    const geometry = ['min-h-14', 'rounded-full', 'px-6', 'text-button', 'font-medium', 'border'];
    for (const variant of VARIANTS) {
      const classes = classesOf(variant);
      for (const name of geometry) expect(classes, variant).toContain(name);
    }
    // Primary is the only plate in the palette's own ink or canvas; tertiary
    // is the only one with neither a fill nor an edge.
    expect(skinOf('primary')).toContain('bg-ink');
    expect(skinOf('night')).toContain('bg-canvas');
    expect(skinOf('secondary')).toContain('bg-surface');
    expect(skinOf('secondary')).toContain('border-hairline');
    for (const tertiary of ['tertiary', 'night-tertiary'] as const) {
      expect(skinOf(tertiary), tertiary).toContain('bg-transparent');
      expect(skinOf(tertiary), tertiary).toContain('border-transparent');
    }
  });

  it('never paints a button in the colour of the ground it stands on', () => {
    // The failure this guards is a night button drawn in the light set: black
    // on #0A0D12 is 1.1:1 and reads as nothing at all.
    for (const night of ['night', 'night-secondary', 'night-tertiary'] as const) {
      expect(skinOf(night).join(' '), night).not.toContain('bg-ink');
      expect(skinOf(night).join(' '), night).not.toContain('text-ink-2');
    }
    for (const day of LEVELS) {
      expect(skinOf(day).join(' '), day).not.toContain('text-white');
    }
  });

  it('keeps every label above the text floor, disabled excepted', () => {
    // Ink on canvas, ink on surface and white on night are all above 15:1.
    // The one text colour anywhere near the floor is the disabled ink-3, and
    // WCAG 1.4.3 exempts a disabled control.
    expect(skinOf('primary')).toContain('text-canvas');
    expect(skinOf('secondary')).toContain('text-ink');
    expect(skinOf('tertiary')).toContain('text-ink');
    for (const night of ['night-secondary', 'night-tertiary'] as const) {
      expect(skinOf(night), night).toContain('text-white');
    }
    expect(classesOf('secondary', { disabled: true })).toContain('text-ink-3');
  });

  it('gives a disabled button no rank, no hover and no press', () => {
    // One disabled skin per ground, whatever level was asked for: a disabled
    // control is not offering anything, so it has nothing to rank.
    for (const variant of VARIANTS) {
      const off = classesOf(variant, { disabled: true });
      expect(off.join(' '), variant).not.toContain('hover:');
      expect(off.join(' '), variant).not.toContain('active:');
      expect(off, variant).toContain('border-transparent');
      expect(off, variant).toContain(
        variant.startsWith('night') ? 'text-white/40' : 'text-ink-3',
      );
    }
    expect(classesOf('primary', { disabled: true }).join(' ')).not.toContain('bg-ink');
  });

  it('carries the hover and the press as utilities, so the press survives the pointer', () => {
    // globals.css puts the 0.7 press on every button in the base layer, and a
    // utility outranks a base rule: without `active:` here the press would
    // disappear under the hover that caused it. Tailwind emits `active:`
    // after `hover:`, so the press wins while both apply.
    for (const variant of VARIANTS) {
      const classes = classesOf(variant);
      expect(classes, variant).toContain('hover:opacity-80');
      expect(classes, variant).toContain('active:opacity-70');
    }
  });

  it('leaves the focus state to the stylesheet, where there is one of them', () => {
    for (const variant of VARIANTS) {
      expect(classesOf(variant).join(' '), variant).not.toContain('focus');
    }
  });

  it('draws the link exactly as it draws the button, so the two cannot drift', () => {
    for (const variant of VARIANTS) {
      const link = renderToStaticMarkup(
        <PillLink href="/invest" variant={variant}>
          Invest now
        </PillLink>,
      );
      const classes = (/<a class="([^"]*)"/.exec(link)?.[1] ?? '').split(/\s+/);
      for (const name of classesOf(variant)) expect(classes, variant).toContain(name);
      expect(classes, variant).toContain('no-underline');
    }
  });

  it('passes an anchor its own attributes, so a link in a navigation can say where it is', () => {
    const link = renderToStaticMarkup(
      <PillLink aria-current="page" href="/invest" variant="night-secondary">
        Earn yield
      </PillLink>,
    );
    expect(link).toContain('aria-current="page"');
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

  it('gives every treatment a separation that survives a content sized card', () => {
    // Home lets the card size to its content, and `render` above passes no
    // height either. An auto margin resolves to nothing in that case, so each
    // face has to declare its own vertical separation or the occupation ends
    // exactly where the label below it begins. jsdom does not lay out, so this
    // asserts the construction, which is the thing that regressed.
    for (const treatment of TREATMENTS) {
      const face = /<div class="(cover-card__content[^"]*)"/.exec(render(treatment))?.[1];
      expect(face).toMatch(/\bgap-\d+\b/);
    }
  });

  it('does not leave the ingot bottom row to mt-auto and a parent height', () => {
    const markup = render('ingot');
    const face = /<div class="(cover-card__content[^"]*)"/.exec(markup)?.[1];
    // The same 40px the wallet card's justify-between gap-10 already gives, so
    // the two are the same height on Home.
    expect(face).toContain('gap-10');
    // mt-auto stays for the landing hero and the gallery, which do set a
    // height, where it seats the bottom row on the bottom edge. It is never the
    // only thing holding the occupation and the "Cover" label apart.
    expect(markup).toContain('mt-auto');
  });

  it('adds no spacing outside the card', () => {
    for (const treatment of TREATMENTS) {
      const outer = /^<div class="([^"]*)"/.exec(render(treatment))?.[1];
      expect(outer).toContain('p-5');
      expect(outer).not.toMatch(/\bm[trblxy]?-/);
    }
  });

  describe('depth is opt in, and treatment agnostic when it is asked for', () => {
    function withDepth(treatment: CardTreatment): string {
      return renderToStaticMarkup(
        <CoverCard
          amount="5,000"
          depth
          hero
          occupation="Office and administrative support"
          state="covered"
          statusLabel="Covered"
          treatment={treatment}
        />,
      );
    }

    it('changes not one character of a card that did not ask for it', () => {
      // The landing hero is the only caller that asks. Every other card in the
      // product has to render exactly what it rendered before, which is what
      // the gallery snapshot beside this also holds.
      for (const treatment of TREATMENTS) {
        const markup = render(treatment);
        for (const depthOnly of [
          'cover-card--depth',
          'cover-card__planes',
          'cover-card__lift-',
          'cover-card__glare',
          'cover-card__edge',
        ]) {
          expect(markup, `${treatment} carries ${depthOnly}`).not.toContain(depthOnly);
        }
      }
    });

    it('leaves the metal finish off every card that did not ask for it', () => {
      // The same rule as depth: the finish is opt in. T34 added the modifier
      // and one light layer, T49 let any screen ask for them, and a card that
      // does not ask still renders neither.
      for (const treatment of TREATMENTS) {
        for (const metalOnly of ['cover-card--metal', 'cover-card__shimmer']) {
          expect(render(treatment), `${treatment} carries ${metalOnly}`).not.toContain(metalOnly);
          expect(withDepth(treatment), `${treatment} carries ${metalOnly}`).not.toContain(metalOnly);
        }
      }
    });

    it('draws the still finish as the edge alone, with no moving band', () => {
      // The addendum's budget is one shimmering element in view. A second
      // metal object on a screen asks for 'still' and gets the same edge and
      // the same sheen with nothing travelling across it.
      for (const treatment of TREATMENTS) {
        const markup = renderToStaticMarkup(
          <CoverCard
            amount="5,000"
            metal="still"
            occupation="Office and administrative support"
            state="covered"
            statusLabel="Covered"
            treatment={treatment}
          />,
        );
        expect(markup, treatment).toContain('cover-card--metal');
        expect(markup, treatment).not.toContain('cover-card__shimmer');
      }
    });

    it('draws the shimmer under the content in all three when it is asked for', () => {
      for (const treatment of TREATMENTS) {
        const markup = renderToStaticMarkup(
          <CoverCard
            amount="5,000"
            depth
            hero
            metal="shimmer"
            occupation="Office and administrative support"
            state="covered"
            statusLabel="Covered"
            treatment={treatment}
          />,
        );
        expect(markup, treatment).toContain('cover-card--metal');
        expect(markup.indexOf('cover-card__shimmer')).toBeGreaterThan(-1);
        expect(markup.indexOf('cover-card__shimmer')).toBeLessThan(
          markup.indexOf('cover-card__content'),
        );
      }
    });

    it('puts all three faces on more than one plane', () => {
      // Which classes a face uses is the face's own anatomy: the wallet and the
      // ingot reach 40 as a 24 inside a 16, the certificate is a flat column
      // and names 40 directly. What has to hold for every one of them is that
      // the contents are on separate planes, so they move against each other.
      for (const treatment of TREATMENTS) {
        const markup = withDepth(treatment);
        expect(markup, treatment).toContain('cover-card__planes');
        const lifts = new Set(
          [...markup.matchAll(/cover-card__lift-(\d+)/g)].map((match) => match[1]),
        );
        expect(lifts.size, `${treatment} sits on one plane`).toBeGreaterThan(1);
      }
    });

    it('puts every light layer before the content in all three', () => {
      for (const treatment of TREATMENTS) {
        const markup = withDepth(treatment);
        for (const layer of ['cover-card__edge', 'cover-card__glare']) {
          expect(markup.indexOf(layer), `${treatment} ${layer}`).toBeGreaterThan(-1);
          expect(markup.indexOf(layer)).toBeLessThan(markup.indexOf('cover-card__content'));
        }
      }
    });
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
    // White at an alpha is the addendum's own rule for a line on the night
    // ground, which the header the frame wears stands on (T52).
    const palette = /^border-(hairline|ink|ink-2|ink-3|canvas|surface|covered|watch|triggered|transparent|white(\/\d+)?)$/;
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
