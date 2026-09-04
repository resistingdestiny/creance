import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7: 16px, underlined, 3px offset, and a hit area
 * of at least 44px. The sheet's engineering note says to pad the hit area and
 * not the glyph, so the link is an inline flex box with a 44px minimum height
 * and negative vertical margin, which keeps the text sitting on its own
 * baseline while the touch target grows around it.
 */

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  /** Gallery only: draws the padded hit area so a reviewer can see it. */
  showHitArea?: boolean;
}

export function TextLink({ children, className, showHitArea = false, ...rest }: TextLinkProps) {
  return (
    <a
      className={[
        'inline-flex min-h-11 items-center text-body text-ink underline underline-offset-[3px] transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none',
        showHitArea ? 'debug-hit-area' : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </a>
  );
}
