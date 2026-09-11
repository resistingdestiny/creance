/**
 * Where you are in the claim, on every screen of it.
 *
 * A claim is four screens and before T57 not one of them said so. A person on
 * the worst day of their working life was asked for their employer, then their
 * documents, then their face, then a signature, with nothing anywhere telling
 * them how much of this there was left. That is the single thing the flow was
 * missing, and it is cheap: four bars and a count.
 *
 * The gate before the flow ("Before you start") and the screens after it have
 * no bar. The gate is not a step you complete and the claim is submitted by the
 * time the status screen is reached, so a bar on either would be counting
 * something that is not happening.
 *
 * The bars are decoration and carry no information a screen reader needs: the
 * same fact is beside them in words, which is the rule the status pill follows
 * too.
 */

/** The four screens of the flow, in order, so the count is written once. */
export const CLAIM_STEPS = 4;

export function ClaimSteps({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-4" data-testid="claim-steps">
      <span aria-hidden="true" className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: CLAIM_STEPS }, (_, index) => (
          <span
            className={[
              'h-[3px] flex-1 rounded-full',
              index < current ? 'bg-ink' : 'bg-hairline',
            ].join(' ')}
            key={index}
          />
        ))}
      </span>
      <span className="shrink-0 text-secondary text-ink-2">
        Step {current} of {CLAIM_STEPS}
      </span>
    </div>
  );
}
