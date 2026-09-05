import type { HTMLAttributes, ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md sections 3 and 7: bg-surface at the group radius with
 * hairline separators between rows, inset 16px from the group's edges. The
 * inset comes from `divide-y divide-hairline` sitting inside `px-4`, which is
 * exactly what the sheet prescribes.
 *
 * `divide-hairline` is written out because a bare `divide-y` in Tailwind v4
 * paints in currentColor, which is black here.
 */

export interface SurfaceGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function SurfaceGroup({ children, className, ...rest }: SurfaceGroupProps) {
  return (
    <div
      className={['rounded-group bg-surface px-4', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <div className="divide-y divide-hairline">{children}</div>
    </div>
  );
}
