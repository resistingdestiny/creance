import type { ReactNode } from 'react';

/**
 * The product's one piece of chrome: the header every screen wears, and the
 * footer the root layout puts under every route.
 *
 * Before T50 there were three visual worlds with nothing shared between them:
 * the landing had a navigation of its own on the night ground, the public
 * explorer had a second header of its own on canvas, and the worker and
 * investor frames had none, so a person going from the front door to a cover
 * went from a full width page to a phone shaped column on bare white with no
 * mark and no way back. Everything here is one component with one height, one
 * mark, one set of links and one set of margins, so moving between the four is
 * moving inside one product.
 *
 * Two tones, not two headers. The landing is the marketing surface and keeps
 * its night ground (docs/DESIGN-TOKENS-ADDENDUM.md, "Marketing surface
 * tokens"), so its header is the night tone of this one component; every
 * other route is the product and stays light, so its header is the day tone.
 * The links, the height and the margins do not change with the tone.
 *
 * Static server markup with no data dependency and no client component, so the
 * landing's shell is still on the first byte (T40) and a worker screen that is
 * a client component can render it. No observer, no scroll listener, no
 * reveal: the chrome is simply there.
 *
 * The height is a token, `--spacing-chrome` in globals.css, because the worker
 * screens measure their column against the viewport and have to know what sits
 * above them; `min-h-frame` is that measurement and this is the only place the
 * height is drawn.
 */

/** The side margins of the chrome and of every frame it wraps. 20 at 390, 40 from lg. */
export const CHROME_PAGE = 'px-5 lg:px-10';

/** The width the chrome's contents and the investor frame share. */
export const CHROME_WIDTH = 'mx-auto w-full max-w-[1280px]';

export type ChromeTone = 'day' | 'night';

/**
 * A navigation link. The design draws these without an underline, which is
 * why they are not the sheet's TextLink: that component is the underlined 16px
 * link inside the app. The 44px minimum tap target is the sheet's rule and
 * applies to both.
 */
export function NavLink({
  children,
  className,
  current = false,
  href,
  tone = 'day',
}: {
  children: ReactNode;
  className?: string;
  current?: boolean;
  href: string;
  tone?: ChromeTone;
}) {
  return (
    <a
      aria-current={current ? 'page' : undefined}
      className={[
        'min-h-11 items-center text-body no-underline transition-opacity duration-200 ease-out motion-reduce:transition-none',
        tone === 'night'
          ? current
            ? 'text-white'
            : 'text-white/66 hover:text-white'
          : current
            ? 'text-ink'
            : 'text-ink-2 hover:text-ink',
        className ?? 'inline-flex',
      ].join(' ')}
      href={href}
    >
      {children}
    </a>
  );
}

/**
 * The header. The wordmark is the way back to the front door, the two links
 * are the two other places the product has, and the action slot is whatever
 * the screen wants in the top right: "Get a quote" on the landing, "Get cover"
 * on the explorer, nothing on a screen that is already inside a cover.
 *
 * "The index" opens the public explorer, which is the page of record for the
 * index (T32), and not the worker's Index tab: that tab is one occupation
 * inside a cover, and a visitor is better served by the page with all fifteen.
 *
 * The wordmark is Creance, where the design file reads Displacement Bond.
 * Displacement Bond Note is the instrument and Creance is the product, which is
 * Root's decision and predates the design file. docs/DECISIONS.md.
 *
 * One line at every width. The two secondary links are hidden below the medium
 * breakpoint rather than wrapped, because a navigation that grows a second row
 * pushes the hero down the screen at 390 and the wordmark and the one action
 * are what has to survive. Both are still in the markup and both are reachable
 * from the footer under every route.
 */
export function SiteHeader({
  action = null,
  current = null,
  tone = 'day',
}: {
  /** The one control in the top right, or nothing. */
  action?: ReactNode;
  /** Which of the two places this screen is, for aria-current. */
  current?: 'index' | 'invest' | null;
  tone?: ChromeTone;
}) {
  const night = tone === 'night';
  return (
    <header
      className={[
        'border-b',
        night ? 'border-white/10 bg-night' : 'border-hairline bg-canvas',
        CHROME_PAGE,
      ].join(' ')}
    >
      <div className={`flex h-chrome items-center justify-between gap-4 ${CHROME_WIDTH}`}>
        <a
          className={[
            'inline-flex min-h-11 items-center no-underline whitespace-nowrap text-body font-semibold',
            night ? 'text-white' : 'text-ink',
          ].join(' ')}
          href="/"
        >
          Creance
        </a>
        <nav aria-label="Main" className="flex items-center gap-x-6 lg:gap-x-8">
          <NavLink
            className="hidden md:inline-flex"
            current={current === 'index'}
            href="/index"
            tone={tone}
          >
            The index
          </NavLink>
          <NavLink
            className="hidden md:inline-flex"
            current={current === 'invest'}
            href="/invest"
            tone={tone}
          >
            Investors
          </NavLink>
          {action}
        </nav>
      </div>
    </header>
  );
}

/**
 * The footer, once, in the root layout. It carries the mark, the two links the
 * header hides at 390, and DESIGN.md's closing line, which the canonical index
 * page and the investor screens make more than decoration.
 *
 * The design's footer bar carries "Terms" and "Contact" beside "How the index
 * works"; neither page exists, so they are left out rather than pointed at
 * something that is not them. docs/DECISIONS.md.
 */
export function SiteFooter() {
  return (
    <footer className={`border-t border-hairline bg-canvas ${CHROME_PAGE}`}>
      <div className={`flex flex-col gap-4 py-8 ${CHROME_WIDTH}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <span className="text-secondary text-ink-2">Creance</span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6">
            <NavLink href="/index">How the index works</NavLink>
            <NavLink href="/invest">Investors</NavLink>
          </nav>
        </div>
        <p className="text-caption text-ink-2">
          This is a testnet prototype built for a hackathon. It is not an offer of insurance or
          securities in any jurisdiction and no real funds are involved.
        </p>
      </div>
    </footer>
  );
}
