import type { TickerReading } from '../../lib/landing-model';

/**
 * The ticker of index readings under the hero.
 *
 * Every figure on it is a live reading of the public index, read on the server
 * from the same round of fifteen the public explorer buys, and worded by the
 * explorer's own helpers. There is no fixture behind it and the browser fetches
 * nothing: the page arrives with the readings already in it.
 *
 * It is aria-hidden. The same readings, in the same words, are the substance of
 * `/index`, which the page links twice; a strip of fifteen occupations moving
 * past is texture for the eye and would be a wall of unordered figures read
 * aloud. Nothing here is the only place anything is said.
 *
 * The travel is a CSS keyframe rather than a script, so it pauses under hover
 * with `animation-play-state` and reduced motion replaces it with its finished
 * state, which is the readings standing still and fully legible. The list is
 * repeated once and the strip travels half its own width; the duplicate is the
 * same content, which is another reason it is hidden from assistive technology.
 *
 * Half the width is one period only because each item carries its own trailing
 * separation. Fifteen items separated by fourteen and a half gaps is what half
 * a thirty item row with a row gap comes to, and the strip jumps that half gap
 * once per loop. The rule is in the stylesheet and the class below is what
 * carries it, so this is a construction the markup has to keep rather than a
 * detail of the spacing.
 */
export function IndexTicker({ readings }: { readings: readonly TickerReading[] }) {
  // No readings, no strip. An empty band with a hairline over it would be a
  // component that failed rather than a page that has nothing to say.
  if (readings.length === 0) return null;

  return (
    <div aria-hidden="true" className="landing-ticker border-t border-white/10">
      <div className="landing-ticker__row motion-reduce:animate-none" data-testid="landing-ticker">
        {[0, 1].map((pass) =>
          readings.map((reading) => (
            <span
              className="landing-ticker__item flex shrink-0 items-baseline gap-2.5 whitespace-nowrap text-secondary"
              key={`${pass}-${reading.occupation}`}
            >
              <span className="font-medium text-white">{reading.occupation}</span>
              <span className="text-white/66">{reading.gap}</span>
            </span>
          )),
        )}
      </div>
    </div>
  );
}
