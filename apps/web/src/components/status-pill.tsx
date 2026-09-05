import type { ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7, with the contrast decision in
 * docs/DECISIONS.md applied: the 6px dot is the state colour and the label is
 * ink. All three state colours clear the 3:1 floor a non-text indicator needs
 * against the near-white pill, and none of them clears 4.5:1 as 13px text.
 *
 * The fourth variant has no dot and an ink-2 label. It is the "Cover ended"
 * case: no state, so no state colour.
 */

export type StatusState = 'covered' | 'watch' | 'triggered' | 'none';

const dotColour: Record<Exclude<StatusState, 'none'>, string> = {
  covered: 'bg-covered',
  watch: 'bg-watch',
  triggered: 'bg-triggered',
};

export function StatusPill({ state, children }: { state: StatusState; children: ReactNode }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/78 px-2.5 py-[5px] text-caption font-medium',
        state === 'none' ? 'text-ink-2' : 'text-ink',
      ].join(' ')}
    >
      {state === 'none' ? null : (
        <span aria-hidden="true" className={`size-1.5 rounded-full ${dotColour[state]}`} />
      )}
      {children}
    </span>
  );
}
