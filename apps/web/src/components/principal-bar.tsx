/**
 * The three-segment principal bar of docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * Segments in this order and no other: paid (ink), reserved (white with a
 * hairline border and a diagonal hatch in hairline), intact (surface). The
 * order is the story the bar tells, left to right: what is gone, what is at
 * stake, what is still the noteholder's.
 *
 * A segment whose value is nought is not rendered. A zero-width segment with a
 * border paints as a one pixel line, and on a series with nothing paid and
 * nothing reserved that reads as an artifact rather than as a state. The
 * rounded ends therefore belong to the outermost segments that exist, which is
 * what `first:` and `last:` do here.
 *
 * The hatch is a repeating-linear-gradient in the global stylesheet, because a
 * gradient at a fixed angle and pitch is not a utility. Nothing here is elevated:
 * depth in this design is hairline and grouping.
 */

export interface PrincipalBarProps {
  paidPercent: number;
  reservedPercent: number;
  intactPercent: number;
  /** Read to a screen reader in place of the bar. The caption repeats it in prose. */
  label: string;
}

export function PrincipalBar({
  paidPercent,
  reservedPercent,
  intactPercent,
  label,
}: PrincipalBarProps) {
  const segments = [
    { key: 'paid', percent: paidPercent, className: 'bg-ink' },
    {
      key: 'reserved',
      percent: reservedPercent,
      className: 'principal-bar__reserved border border-hairline bg-canvas',
    },
    { key: 'intact', percent: intactPercent, className: 'bg-surface' },
  ].filter((segment) => segment.percent > 0);

  return (
    <div
      aria-label={label}
      className="flex h-3 w-full overflow-hidden rounded-full"
      data-testid="principal-bar"
      role="img"
    >
      {segments.map((segment) => (
        <span
          className={`h-full first:rounded-l-full last:rounded-r-full ${segment.className}`}
          data-segment={segment.key}
          key={segment.key}
          style={{ width: `${segment.percent}%` }}
        />
      ))}
    </div>
  );
}
