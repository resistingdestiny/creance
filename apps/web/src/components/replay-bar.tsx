/**
 * The demo clock is labelled as a replay wherever it is running, so nobody
 * watching a recording has to guess whether a month passed in ten seconds.
 *
 * One component, two variants and one source of truth for the label. The
 * compact form is a line in an app screen's header; the full form is a sticky
 * bar at the top of a public page. The dot is the `watch` state colour and the
 * label is ink, because a state colour is an indicator and not text.
 */

export function ReplayBar({
  label,
  variant = 'full',
  detail,
}: {
  label: string;
  variant?: 'full' | 'compact';
  detail?: string;
}) {
  if (variant === 'compact') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption font-medium text-ink">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-watch" />
        {label}
      </span>
    );
  }

  return (
    <div className="sticky top-0 z-40 flex min-h-[52px] w-full flex-col justify-center border-b border-hairline bg-surface px-5 py-2">
      <span className="inline-flex items-center gap-1.5 text-secondary font-medium text-ink">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-watch" />
        {label}
      </span>
      {detail ? <span className="text-caption text-ink-2">{detail}</span> : null}
    </div>
  );
}
