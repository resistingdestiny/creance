import { AppFrame } from '../../components/app-frame';
import { PillLink } from '../../components/pill-button';
import type { PolicyClaimsBlock } from '../../lib/worker-api';

/**
 * "Claims aren't open." One calm screen, docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * Every sentence is printed exactly as the API composed it. They are composed
 * server side so that two screens cannot say one reading differently, and so
 * that a level line is always said as a distance from average rather than as a
 * signed number, which is the rule the chart's band label follows too
 * (docs/DECISIONS.md, "A consumer is never shown a signed index value"). The
 * app fills in no numbers of its own here.
 *
 * The same screen carries the other two refusals the block can name: a cover
 * that has already had its claim, and a cover that cannot be claimed on at
 * all. The title comes with the block, so the heading is right for each.
 */

/** What the block would have said, for a cover the API could not read a chain state for. */
const UNREADABLE: PolicyClaimsBlock = {
  open: false,
  code: 'claims_not_open',
  title: "Claims aren't open.",
  reason_lines: ["We'll tell you here if that changes."],
  reading: null,
};

export function ClaimsClosed({ claims }: { claims: PolicyClaimsBlock | null }) {
  const block = claims ?? UNREADABLE;

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {block.title}
          </h1>
          {block.reason_lines.map((line) => (
            <p className="text-body-lg text-ink-2" key={line}>
              {line}
            </p>
          ))}
        </div>
        <PillLink href="/home" variant="secondary">
          Back to cover
        </PillLink>
      </main>
    </AppFrame>
  );
}
