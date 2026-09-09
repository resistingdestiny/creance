import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, describe, expect, it } from 'vitest';

import { COLOUR_TOKENS, contrastRatio, passesTextFloor } from '../src/lib/tokens.js';

/**
 * These run against the stylesheet as the browser receives it, not against the
 * source, because every claim here is about the compiled output: a token that
 * did not survive the theme block, a shadow that a utility reintroduced, a
 * focus state that a variant quietly replaced.
 *
 * The whole app is compiled as the source set so that every utility any
 * component uses is present, which is the only way "no rule sets a box-shadow"
 * can mean anything.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = fileURLToPath(new URL('../src/app/globals.css', import.meta.url));

let css = '';

beforeAll(async () => {
  const result = await postcss([tailwind()]).process(readFileSync(entry, 'utf8'), {
    from: entry,
  });
  css = result.css;
}, 60_000);

/** Every declaration block whose selector matches, as [selector, body] pairs. */
function blocksMatching(pattern: RegExp): [string, string][] {
  const blocks: [string, string][] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (pattern.test(selector)) blocks.push([selector, body]);
  }
  return blocks;
}

describe('the theme block is the config', () => {
  it('compiles at all, so the source set really is the whole app', () => {
    expect(root).toContain('apps/web');
    expect(css.length).toBeGreaterThan(1000);
  });

  it('resolves every colour token to its hex', () => {
    for (const token of COLOUR_TOKENS) {
      expect(css.toLowerCase()).toContain(`--color-${token.name}: ${token.hex.toLowerCase()}`);
    }
  });

  it('carries the type scale with its line heights attached', () => {
    for (const [role, size, lineHeight] of [
      ['display-xl', '64px', '68px'],
      ['display-l', '56px', '60px'],
      ['headline', '36px', '40px'],
      ['title', '26px', '32px'],
      ['body-lg', '18px', '24px'],
      ['body', '16px', '24px'],
      ['button', '17px', '22px'],
      ['secondary', '14px', '20px'],
      ['caption', '13px', '18px'],
    ] as const) {
      expect(css).toContain(`--text-${role}: ${size}`);
      expect(css).toContain(`--text-${role}--line-height: ${lineHeight}`);
    }
  });

  it('carries the landing scale with its ratios attached', () => {
    // docs/DESIGN-TOKENS.md section 2, "Landing (web) adds", plus the three
    // sizes the design of record draws at 1440. Marketing surface only.
    for (const [role, size, lineHeight] of [
      ['landing-hero', '104px', '1.02'],
      ['landing-amount', '108px', '0.95'],
      ['landing-reading', '96px', '1'],
      ['landing-step', '72px', '1'],
      ['landing-ledger', '56px', '1.1'],
      ['landing-head', '44px', '1.15'],
      ['landing-lead', '22px', '1.5'],
    ] as const) {
      expect(css).toContain(`--text-${role}: ${size}`);
      expect(css).toContain(`--text-${role}--line-height: ${lineHeight}`);
    }
    for (const [role, value] of [
      ['landing-hero', '-0.035em'],
      ['landing-tight', '-0.03em'],
      ['landing-ledger', '-0.025em'],
    ] as const) {
      expect(css).toContain(`--tracking-${role}: ${value}`);
    }
  });

  it('keeps the step numeral grey as a named token rather than an arbitrary value', () => {
    expect(css).toContain('--color-landing-numeral: #c9cdd4');
  });

  it('carries the four radii', () => {
    expect(css).toContain('--radius-field: 12px');
    expect(css).toContain('--radius-group: 16px');
    expect(css).toContain('--radius-card: 20px');
    expect(css).toContain('--radius-hero: 32px');
  });

  it('drops the default palette, so an off-palette colour cannot be reached', () => {
    expect(css).not.toMatch(/--color-red-500:/);
    expect(css).not.toMatch(/--color-gray-500:/);
    expect(css).not.toMatch(/--color-slate-\d/);
  });
});

describe('no drop shadows, and one elevation on the marketing surface', () => {
  it('sets box-shadow to nothing but none, or to the one permitted elevation', () => {
    // T33 spends the elevation the addendum permits. It is still the only
    // shadow in the build: every other value in the compiled stylesheet is
    // none, which is what stops a second one arriving by habit.
    const values = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)].map((match) =>
      (match[1] ?? '').trim(),
    );
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(['none', 'var(--elevation-hero)']).toContain(value);
    }
  });

  it('spends the marketing elevation on one selector and no other', () => {
    // docs/DESIGN-TOKENS-ADDENDUM.md permits it on the landing hero card only.
    // `.cover-card--depth` is carried when a caller passes `depth`, and the
    // landing hero is the only caller that does.
    expect(css).toContain('--elevation-hero:');
    const lifted = blocksMatching(/./)
      .filter(([, body]) => /box-shadow:\s*var\(--elevation-hero\)/.test(body))
      .map(([selector]) => selector);
    expect(lifted).toStrictEqual(['.cover-card--depth']);
  });
});

describe('one focus state', () => {
  it('is 2px solid black with a 2px offset wherever focus-visible is styled', () => {
    const blocks = blocksMatching(/focus-visible/);
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, body] of blocks) {
      expect(body).toMatch(/outline:\s*2px solid #000/);
      expect(body).toMatch(/outline-offset:\s*2px/);
    }
  });

  it('overrides the browser default that the reset restores', () => {
    // Preflight restores Firefox's own ring with `:-moz-focusring { outline:
    // auto }`. The base layer names that selector afterwards so the design's
    // outline wins rather than the browser's.
    expect(css).toMatch(/-moz-focusring[^{]*\{[^}]*outline:\s*2px solid #000/);
  });

  it('never removes an outline on focus', () => {
    for (const [, body] of blocksMatching(/focus/)) {
      expect(body).not.toMatch(/outline:\s*(none|0)\b/);
      expect(body).not.toMatch(/outline-width:\s*0\b/);
    }
  });
});

describe('hairlines and the card', () => {
  it('keeps the hairline at one pixel in the token colour', () => {
    expect(css).toContain('--color-hairline: #e4e6ea');
    expect(css).toMatch(/\.cover-card\s*\{[^}]*border:\s*1px solid #e4e6ea/);
  });

  it('lifts the card content above both overlays', () => {
    expect(css).toMatch(/\.cover-card::before\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.cover-card--hero::after\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.cover-card__content\s*\{[^}]*z-index:\s*10/);
  });

  it('keeps every light layer beneath the content, including the glare', () => {
    // The one defect a card of this kind ships with is light painted across the
    // occupation or the amount. The sheen and the brushing are pseudo-elements
    // with no z-index of their own, so they sit at 0; the glare names 1; the
    // content names 10. This asserts the order in the compiled stylesheet,
    // because the source order alone would not decide it.
    const glare = blocksMatching(/^\.cover-card__glare$/)[0]?.[1] ?? '';
    expect(glare).toMatch(/z-index:\s*1\b/);
    expect(glare).toMatch(/pointer-events:\s*none/);
    const content = blocksMatching(/^\.cover-card__content$/)[0]?.[1] ?? '';
    expect(Number(/z-index:\s*(\d+)/.exec(content)?.[1])).toBeGreaterThan(1);
    for (const [, body] of blocksMatching(/\.cover-card(--\w+)?::(before|after)$/)) {
      expect(body).not.toContain('z-index');
    }
  });

  it('gives the depth card back its overflow, or it could have no depth at all', () => {
    // A grouping property forces transform-style to flat, so a card that clips
    // its own overflow is flat whatever else it declares. The two light layers
    // clip themselves to the radius instead.
    const depth = blocksMatching(/^\.cover-card--depth$/)[0]?.[1] ?? '';
    expect(depth).toMatch(/overflow:\s*visible/);
    expect(depth).toMatch(/transform-style:\s*preserve-3d/);
    expect(css).toMatch(
      /\.cover-card--depth::before,\s*\.cover-card--depth::after\s*\{[^}]*overflow:\s*hidden/,
    );
  });

  it('separates the ticker items with a trailing margin and never a row gap', () => {
    // The travel is translateX(-50%) and the loop only closes if half the row
    // is exactly the distance from an item to its duplicate. Thirty items with
    // a row gap are twenty nine gaps wide, so half of them is half a gap short
    // and the strip jumps 28px once per loop. A trailing margin on the item
    // makes every item the same width including its separation.
    const row = blocksMatching(/^\.landing-ticker__row$/)[0]?.[1] ?? '';
    expect(row).toMatch(/animation:\s*landing-ticker/);
    expect(row).not.toMatch(/(^|;)\s*gap:/);
    expect(row).not.toMatch(/column-gap:/);
    const item = blocksMatching(/^\.landing-ticker__item$/)[0]?.[1] ?? '';
    expect(item).toMatch(/margin-inline-end:\s*56px/);
    expect(css).toMatch(/@keyframes landing-ticker[^}]*\{[^}]*translateX\(-50%\)/);
  });

  it('replaces the ticker and the tilt with their finished state under reduced motion', () => {
    // The ticker's own animation is turned off by the motion-reduce utility on
    // the element; the tilt's ease back is a transition, which only CSS can
    // reach, so the stylesheet turns it off here.
    expect(css).toMatch(/\.landing-ticker__row\s*\{[^}]*animation:\s*landing-ticker/);
    expect(css).toMatch(
      /\.landing-ticker:hover\s+\.landing-ticker__row\s*\{[^}]*animation-play-state:\s*paused/,
    );
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?\.cover-card-tilt[^}]*\{[^}]*transition:\s*none/);
  });

  it('turns the card on an element of its own, and stands it still under the preference', () => {
    // The tilt carries an inline transform written per frame, so the turn
    // cannot share that element: one element holds one transform, and a
    // keyframe animation there would outrank the inline style for good.
    const turn = blocksMatching(/^\.cover-card-turn$/)[0]?.[1] ?? '';
    expect(turn).toMatch(/transform-style:\s*preserve-3d/);
    expect(turn).toMatch(/transition:\s*transform \d+ms/);
    expect(css).toMatch(
      /prefers-reduced-motion[\s\S]*?\.cover-card-turn[^}]*\{[^}]*transition:\s*none/,
    );
  });

  it('shows one face at a time and lets one of them size the object', () => {
    const face = blocksMatching(/^\.cover-card-face$/)[0]?.[1] ?? '';
    expect(face).toMatch(/backface-visibility:\s*hidden/);
    expect(face).toMatch(/transform-style:\s*preserve-3d/);
    // Hidden outright, not left to backface-visibility: that applies to the
    // element carrying it and not to the preserve-3d subtree under it, and this
    // card's thickness and its lifted content are in that subtree. It leaves
    // the flow too, so the object is as tall as the face being read.
    const away = blocksMatching(/\.cover-card-face\[data-facing="away"\]/)[0]?.[1] ?? '';
    expect(away).toMatch(/position:\s*absolute/);
    expect(away).toMatch(/visibility:\s*hidden/);
  });

  it('flattens the perspective at narrow widths so the card stays in its column', () => {
    const values = blocksMatching(/^\.cover-card-stack$/).map(
      ([, body]) => /perspective:\s*(\d+)px/.exec(body)?.[1],
    );
    expect(values.filter(Boolean)).toHaveLength(2);
    // The narrow one comes first and is the flatter of the two: the same
    // rotation over a smaller card reads as a wider swing.
    expect(Number(values[0])).toBeGreaterThan(Number(values[1]));
  });

  it('lets the turn carry the shimmer without taking the animation off it', () => {
    // The band keeps its own travel and the turn adds an offset to it, so the
    // highlight moves across the metal as the surface swings through the light
    // instead of sitting still on a rotating card.
    expect(css).toMatch(
      /@keyframes cover-card-shimmer[\s\S]*?translateX\(calc\(-30% \+ var\(--card-shimmer-shift, 0px\)\)\)/,
    );
  });

  it('reads every label on a card face in ink, whatever component drew it', () => {
    // ink-2 is 3.47:1 on the darkest gradient stop of any treatment and fails
    // the floor. The quote's steps are built from components that stand on
    // canvas everywhere else, where the same colour is 5.2:1 and right.
    const promoted = blocksMatching(/\.cover-card__content \.text-ink-2/);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.[1]).toMatch(/color:\s*var\(--color-ink\)/);
    expect(passesTextFloor(contrastRatio('#000000', '#d9dce2'))).toBe(true);
    expect(passesTextFloor(contrastRatio('#6b6f76', '#d9dce2'))).toBe(false);
  });

  it('draws the certificate edge without touching the base card rule', () => {
    // 1b is a modifier, never an edit to `.cover-card`: the base border above
    // still has to be the hairline. The metallic edge is one pixel of gradient
    // in the border box with the face in the padding box, so the border stays
    // and only its colour goes.
    expect(css).toMatch(/\.cover-card--certificate\s*\{[^}]*border-color:\s*transparent/);
    expect(css).toMatch(/\.cover-card--certificate\s*\{[^}]*#fcfcfd 0%, #eff1f4 100%\) padding-box/);
    expect(css).toMatch(/\.cover-card--certificate\s*\{[^}]*#c9cdd4 100%\) border-box/);
  });

  it('draws the ingot as a deeper gradient under horizontal brushing', () => {
    expect(css).toMatch(/\.cover-card--ingot\s*\{[^}]*border-color:\s*#dfe2e7/);
    expect(css).toMatch(/\.cover-card--ingot\s*\{[^}]*linear-gradient\(180deg, #f0f1f4 0%, #d9dce2 100%\)/);
    expect(css).toMatch(/\.cover-card--ingot::before\s*\{[^}]*repeating-linear-gradient\(180deg/);
  });

  it('keeps both new treatments' + "'" + ' overlays on the pseudo-elements the base rule positions', () => {
    // The overlays must stay pseudo-elements with pointer-events none and the
    // content lifted above them, which is the one thing the card most often
    // gets wrong. Neither modifier reopens `inset` on ::before except to sit
    // the certificate sheen inside its edge.
    expect(css).toMatch(/\.cover-card--certificate::before\s*\{[^}]*inset:\s*1px/);
    for (const [selector, body] of blocksMatching(/\.cover-card--(certificate|ingot)/)) {
      expect(selector).toMatch(/::(before|after)$|^\.cover-card--(certificate|ingot)$/);
      expect(body).not.toContain('z-index');
    }
  });

  it('puts the landing glow behind the card as a gradient, not an elevation', () => {
    expect(css).toMatch(/\.landing-glow\s*\{[^}]*radial-gradient/);
  });

  it('gives the body tabular figures', () => {
    expect(css).toMatch(/body\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});

describe('the metal finish and its rainbow shimmer', () => {
  /**
   * The darkest gradient stop of each of the three card treatments, from the
   * table in src/components/cover-card.tsx: the wallet, the certificate and the
   * ingot. The shimmer is a modifier over whichever one is drawn, so the worst
   * case for a label on the card is the worst of these under the strongest
   * stop of the shimmer.
   */
  const DARKEST = ['#dfe2e7', '#eff1f4', '#d9dce2'];

  /** An rgba layer composited over an opaque ground, as the browser does it. */
  function over(layer: readonly [number, number, number, number], ground: string): string {
    const base = [1, 3, 5].map((at) => Number.parseInt(ground.slice(at, at + 2), 16));
    const mixed = layer
      .slice(0, 3)
      .map((channel, at) => Math.round(channel * layer[3] + (base[at] ?? 0) * (1 - layer[3])));
    return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  it('is a modifier, and never an edit to the card rule or to its overlays', () => {
    // The addendum says the card gradient, its sheen and its brushing are
    // unchanged. The modifier adds an edge colour and one new layer, and it
    // reopens neither pseudo-element the base rule positions.
    const metal = blocksMatching(/^\.cover-card--metal$/)[0]?.[1] ?? '';
    expect(metal).toMatch(/border-color:\s*#cfd4dc/);
    expect(metal).not.toContain('background');
    for (const [selector] of blocksMatching(/\.cover-card--metal/)) {
      expect(selector).toBe('.cover-card--metal');
    }
  });

  it('keeps the shimmer over the glare and under the content, like every other light layer', () => {
    const shimmer = blocksMatching(/^\.cover-card__shimmer$/)[0]?.[1] ?? '';
    expect(shimmer).toMatch(/z-index:\s*2\b/);
    expect(shimmer).toMatch(/pointer-events:\s*none/);
    const content = blocksMatching(/^\.cover-card__content$/)[0]?.[1] ?? '';
    expect(Number(/z-index:\s*(\d+)/.exec(content)?.[1])).toBeGreaterThan(2);
  });

  it('stops dead under reduced motion, leaving the colour standing still', () => {
    expect(css).toMatch(/@keyframes cover-card-shimmer/);
    expect(css).toMatch(
      /prefers-reduced-motion[\s\S]*?\.cover-card__shimmer::before[^}]*\{[^}]*animation:\s*none/,
    );
  });

  it('leaves a label on the card far above the contrast floor wherever it lands', () => {
    // Every stop is a pale hue at a low alpha, so the composite is lighter than
    // the metal under it rather than darker. This computes that from the rule
    // in the stylesheet rather than taking it on trust, because a stop darkened
    // later is exactly how light over a card starts hiding the numbers.
    const rule = blocksMatching(/^\.cover-card__shimmer::before$/)[0]?.[1] ?? '';
    const stops = [...rule.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)];
    expect(stops.length).toBeGreaterThan(3);

    for (const stop of stops) {
      const layer = [
        Number(stop[1]),
        Number(stop[2]),
        Number(stop[3]),
        Number(stop[4]),
      ] as const;
      for (const ground of DARKEST) {
        const composite = over(layer, ground);
        // Ink, which is what every label on the card is.
        expect(passesTextFloor(contrastRatio('#000000', composite)), composite).toBe(true);
        expect(contrastRatio('#000000', composite)).toBeGreaterThan(12);
      }
    }
  });
});
