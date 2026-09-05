import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7. Primary is black with white text at the
 * button scale; secondary is white with a hairline border; disabled is surface
 * with ink-3 text, which is the one place ink-3 is allowed to be text because
 * disabled controls are exempt from WCAG 1.4.3.
 *
 * The loading state swaps the label for a row of pulsing dots and the width
 * does not change. That is done by keeping the label in the layout with
 * `invisible` and painting the dots over it, rather than by measuring anything,
 * so the width is identical by construction and not by luck.
 */

export type PillButtonVariant = 'primary' | 'secondary';

export interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

const base =
  'relative inline-flex min-h-14 items-center justify-center rounded-full px-6 text-button font-medium transition-opacity duration-200 ease-out motion-reduce:transition-none';

const variants: Record<PillButtonVariant, string> = {
  primary: 'bg-ink text-canvas',
  secondary: 'border border-hairline bg-canvas text-ink',
};

const disabledStyle = 'bg-surface text-ink-3 border-transparent';

export function PillButton({
  variant = 'primary',
  loading = false,
  disabled = false,
  children,
  className,
  ...rest
}: PillButtonProps) {
  const inert = disabled || loading;
  const skin = disabled ? disabledStyle : variants[variant];

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
 * The same pill, as a link. The investor overview's "Subscribe" moves to
 * another route rather than doing something in place, and a button that
 * navigates is a link with the wrong element: it loses the middle click, the
 * open in a new tab and the status bar preview a person expects from one.
 *
 * The classes are the button's own, so the two cannot drift apart.
 */
export function PillLink({
  variant = 'primary',
  href,
  children,
  className,
}: {
  variant?: PillButtonVariant;
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={[base, variants[variant], 'no-underline', className].filter(Boolean).join(' ')}
      href={href}
    >
      {children}
    </a>
  );
}
