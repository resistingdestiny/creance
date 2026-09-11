import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Every button in the product, at three levels and no more.
 *
 * Before this there were five things that all behaved like buttons and none of
 * which agreed: a solid black pill, a white pill with a hairline, an outlined
 * pill on the night ground, plain text links doing a button's job in the
 * header, and a handful of controls styled inline in the one page that used
 * them. A person cannot learn a hierarchy from that, because there is not one.
 * The three levels below are the whole vocabulary, they are drawn here and
 * nowhere else, and a screen that wants a fourth weight is a screen that has
 * two primaries and should lose one.
 *
 * **Primary** is the one thing a screen is for: a solid plate, ink on the light
 * ground and canvas on the night ground. One per screen.
 * **Secondary** is the real alternative beside it: a tinted plate with a
 * visible edge. It reads as a button at a glance and it never outranks the
 * plate beside it, because a fill of surface is not a fill of ink.
 * **Tertiary** is the quiet repeat or the escape: the label alone, on the same
 * geometry as the other two, with no fill and no edge.
 *
 * The `night` half of each level is the same button on the marketing surface's
 * dark ground, which docs/DESIGN-TOKENS-ADDENDUM.md permits on the landing page
 * and on the header band (T52) and nowhere else. They exist because the light
 * set is unreadable there: primary is black on #0A0D12, which is 1.1:1 and
 * effectively invisible, and secondary's hairline disappears into the same
 * ground. Inverting them is the fix, and it is a variant rather than an
 * override so that no more specific selector can quietly paint a button in the
 * colour of the ground it stands on.
 *
 * The five states, and where each of them comes from:
 *
 * - **Rest** is the table below. Every level carries `border`, including the
 *   two that draw it transparent, so that all three are the same height and
 *   the same width for the same label and a screen can swap one for another
 *   without the row moving.
 * - **Hover** is opacity and only opacity, which is the one hover
 *   docs/DESIGN-TOKENS.md section 6 permits on a button. It is written as a
 *   utility rather than left to a colour change so that all six variants
 *   behave the same on both grounds.
 * - **Active** is the 0.7 press src/app/globals.css sets on every button in
 *   the base layer. It is repeated here as a utility because the hover above
 *   is one, and a utility outranks a base rule: without it the press would
 *   vanish under the pointer that caused it. Tailwind emits `active:` after
 *   `hover:`, so the press wins while both apply.
 * - **Focus** is the 2px outline the base layer puts on everything, turned
 *   white by the `[data-tone="night"]` rule for the ground it stands on. It is
 *   deliberately not restated here: one focus state in the design means one
 *   rule in the stylesheet, and every night surface in the product, the header
 *   band and the landing's two dark sections, carries that attribute.
 * - **Disabled** is surface with ink-3 on the light ground, which is the one
 *   place ink-3 is allowed to be text because disabled controls are exempt
 *   from WCAG 1.4.3, and its inversion on the night ground. It replaces the
 *   level outright: a disabled button has no rank.
 *
 * The loading state swaps the label for a row of pulsing dots and the width
 * does not change. That is done by keeping the label in the layout with
 * `invisible` and painting the dots over it, rather than by measuring anything,
 * so the width is identical by construction and not by luck.
 */

export type PillButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'night'
  | 'night-secondary'
  | 'night-tertiary';

export interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

const base =
  'relative inline-flex min-h-14 items-center justify-center rounded-full border px-6 text-button font-medium transition-opacity duration-200 ease-out motion-reduce:transition-none';

/** Hover and press, the only two feedbacks section 6 gives a button. */
const press = 'hover:opacity-80 active:opacity-70';

const variants: Record<PillButtonVariant, string> = {
  primary: 'border-ink bg-ink text-canvas',
  secondary: 'border-hairline bg-canvas text-ink',
  tertiary: 'border-transparent bg-transparent text-ink',
  night: 'border-canvas bg-canvas text-ink',
  'night-secondary': 'border-white/40 bg-white/12 text-white',
  'night-tertiary': 'border-transparent bg-transparent text-white',
};

/* Disabled has to differ from the secondary in more than its text, because a
   secondary standing on its own under a field is exactly where a reader asks
   "is that greyed out?". So the two differ in all three: the secondary draws a
   hairline and stands on canvas, and disabled draws no edge and is the filled
   plate. Contrast on the label is the one thing that may fall here, and WCAG
   1.4.3 exempts a disabled control from the floor. */
const disabledStyles: Record<'day' | 'night', string> = {
  day: 'border-transparent bg-surface text-ink-3',
  night: 'border-transparent bg-white/8 text-white/40',
};

function groundOf(variant: PillButtonVariant): 'day' | 'night' {
  return variant.startsWith('night') ? 'night' : 'day';
}

export function PillButton({
  variant = 'primary',
  loading = false,
  disabled = false,
  children,
  className,
  ...rest
}: PillButtonProps) {
  const inert = disabled || loading;
  // A disabled button has no hover and no press: the cursor already says so,
  // and an opacity change under the pointer would read as a control that did
  // something.
  const skin = disabled
    ? disabledStyles[groundOf(variant)]
    : `${variants[variant]} ${inert ? '' : press}`;

  return (
    <button
      aria-busy={loading || undefined}
      className={[base, skin, className].filter(Boolean).join(' ')}
      disabled={inert}
      type="button"
      {...rest}
    >
      {/* The label stays in the flow while loading so the width is unchanged. */}
      <span className={loading ? 'invisible' : undefined}>{children}</span>
      {loading ? <LoadingDots /> : null}
    </button>
  );
}

/**
 * Six 6px dots. Under reduced motion they stop pulsing and sit at full
 * opacity: the state is still readable, nothing moves.
 */
function LoadingDots() {
  return (
    <span
      className="absolute inset-0 flex items-center justify-center gap-1.5"
      data-testid="pill-button-loading-dots"
    >
      <span className="sr-only">Working</span>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
          key={index}
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * The same three levels, as a link. The investor page's call to action and the
 * header's move to another route rather than doing something in place, and a
 * button that navigates is a link with the wrong element: it loses the middle
 * click, the open in a new tab and the status bar preview a person expects
 * from one.
 *
 * The classes are the button's own, so the two cannot drift apart. The rest of
 * the anchor's attributes are passed through, because a link in a navigation
 * has to be able to say `aria-current` and a link off the site has to be able
 * to say `rel`.
 */
export function PillLink({
  variant = 'primary',
  href,
  children,
  className,
  ...rest
}: {
  variant?: PillButtonVariant;
  href: string;
  children: ReactNode;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>) {
  return (
    <a
      className={[base, variants[variant], press, 'no-underline', className]
        .filter(Boolean)
        .join(' ')}
      href={href}
      {...rest}
    >
      {children}
    </a>
  );
}
