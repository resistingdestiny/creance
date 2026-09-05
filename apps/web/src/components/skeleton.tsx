/**
 * Surface at the field radius, the exact final dimensions, and no animation.
 *
 * There is no shimmer. The design animates on user action and once after
 * payment, and nothing else, so a loading placeholder that pulses would be the
 * only thing moving on the screen. It is aria-hidden; the container that will
 * hold the content carries aria-busy while the skeleton is up.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={['rounded-field bg-surface', className].filter(Boolean).join(' ')}
    />
  );
}

export function SkeletonRow() {
  return <Skeleton className="h-[52px] w-full" />;
}

export function SkeletonFigure() {
  return <Skeleton className="h-[60px] w-40" />;
}

export function SkeletonChart() {
  return <Skeleton className="h-[180px] w-full" />;
}
