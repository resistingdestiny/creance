import {
  ATTRIBUTION_CORRELATION,
  ATTRIBUTION_HEADING,
  ATTRIBUTION_LIMITS,
  ATTRIBUTION_SETTLEMENT,
  ATTRIBUTION_SOURCE,
  STRIP_HEIGHT,
  type AttributionPanelData,
} from '../lib/attribution-model';

/**
 * The attribution panel, under the index on the Index tab.
 *
 * DESIGN.md 3.3: "Basis risk remains on the attribution side: an occupation
 * specific shock that has nothing to do with AI also opens claims, and the loss
 * key does not try to tell the two apart." This panel is that sentence on a
 * screen. It publishes what employers themselves said about AI beside the index
 * that pays, and it says which of the two decides a payout.
 *
 * It is separated from the index by a hairline and its own heading, and it is
 * deliberately not a second index chart. The index line has section 5 of
 * docs/DESIGN-TOKENS.md to itself: a black line, a red trigger band, a band
 * label. None of that appears here. This is a neutral bar strip in ink-3 over a
 * hairline baseline, in the form the "What would have happened" strip above it
 * already uses, so no reader can mistake it for the line that opens claims.
 *
 * The settlement sentences are body copy in ink at the top of the panel, before
 * any figure. A caveat under a chart is read after the number it qualifies, and
 * this one has to be read first.
 *
 * Forty months across the 344px content width of the 390 frame is about six
 * pixels a column, so the strip carries two axis labels and no more. The heights
 * come from the model; a recorded zero has no bar and the flat baseline is what
 * a zero looks like.
 */

export function AttributionPanel({ data }: { data: AttributionPanelData }) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-body-lg font-medium text-ink">{ATTRIBUTION_HEADING}</h2>
        {ATTRIBUTION_SETTLEMENT.map((line) => (
          <p className="text-body text-ink" key={line}>
            {line}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-title font-display font-semibold tracking-title tabular-nums text-ink">
          {data.cumulative}
        </p>
        <p className="text-secondary text-ink-2">
          Announced cuts since {data.firstMonth} where the employer named AI. In{' '}
          {data.latestMonth}, {data.latestCuts}.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          aria-hidden="true"
          className="flex items-end gap-[3px] border-b border-hairline"
          style={{ height: `${STRIP_HEIGHT}px` }}
        >
          {data.bars.map((bar) => (
            <span
              className="w-full rounded-t-[2px] bg-ink-3"
              key={bar.period}
              style={{ height: `${bar.height}px` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-caption text-ink-3">
          <span>{data.axis[0]}</span>
          <span>{data.axis[1]}</span>
        </div>
        <p className="sr-only">{data.description}</p>
      </div>

      <p className="text-caption text-ink-2">{data.untrackedNote}</p>
      {data.alignmentNote === null ? null : (
        <p className="text-caption text-ink-2">{data.alignmentNote}</p>
      )}
      {data.fallbackNote === null ? null : (
        <p className="text-caption text-ink-2">{data.fallbackNote}</p>
      )}

      <div className="flex flex-col gap-2">
        {ATTRIBUTION_CORRELATION.map((line) => (
          <p className="text-secondary text-ink-2" key={line}>
            {line}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-body font-medium text-ink">What this number does not tell you</h3>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-secondary text-ink-2">
          {ATTRIBUTION_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>

      <p className="text-caption text-ink-2">{ATTRIBUTION_SOURCE}</p>
    </section>
  );
}
