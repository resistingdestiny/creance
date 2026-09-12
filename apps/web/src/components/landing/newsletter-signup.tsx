import { joinNewsletter } from '../../app/newsletter-actions';
import {
  NEWSLETTER_NOTICE,
  newsletterMessage,
  type NewsletterOutcome,
} from '../../lib/newsletter-model';
import { PillButton } from '../pill-button';

/**
 * Leave an address, and be told the truth about what happens to it.
 *
 * One field, one button and two sentences. The first sentence says what the
 * address is for and the second says what is actually done with it, which on
 * this deployment is one row in a table and nothing else. Both are on the page
 * before anybody types, rather than behind a link to a policy, because a person
 * deciding whether to hand over an address is deciding it in the second they
 * look at the field and not after a second page load.
 *
 * It is a form element posting to a server action, so it works before hydration
 * and with JavaScript off: the press posts, the action writes the row, and the
 * answer is a fresh render of this page with the outcome in the address. That
 * is the shape the market's trading forms use (src/app/invest/trading.tsx) and
 * it is the right one here for the same reason. Nothing in this file is a
 * client component and nothing in it has state.
 *
 * What comes back is a code and never a sentence. `outcome` is one of three
 * words out of a fixed list and the words a reader sees are written in
 * src/lib/newsletter-model.ts, so a query string cannot put a sentence on
 * somebody else's screen, and the answer never repeats the address that was
 * typed.
 *
 * The same answer comes back whether the address was new or already held. The
 * API refuses to tell this page which, so this page cannot tell a reader, and a
 * stranger with somebody else's address cannot use the form to find out whether
 * that person signed up.
 *
 * Both grounds, because the landing page has two. `tone` is the only thing that
 * changes: the same markup, the same field and the same words, drawn in the
 * palette of whichever ground it is standing on.
 */

export type NewsletterTone = 'day' | 'night';

export interface NewsletterSignupProps {
  /**
   * What the last press did, from `?news=` on the landing page. Null is the
   * ordinary state: nobody has pressed anything.
   */
  outcome?: NewsletterOutcome | null;
  /** Which of the landing page's two grounds this is standing on. */
  tone?: NewsletterTone;
  className?: string;
}

/** The two palettes, so no colour in the markup below belongs to one ground. */
const PALETTE: Record<
  NewsletterTone,
  {
    heading: string;
    body: string;
    caption: string;
    field: string;
    button: 'secondary' | 'night';
  }
> = {
  day: {
    heading: 'text-ink',
    body: 'text-ink-2',
    caption: 'text-ink-2',
    field: 'border-hairline bg-surface text-ink placeholder:text-ink-3',
    button: 'secondary',
  },
  night: {
    heading: 'text-white',
    body: 'text-white/66',
    caption: 'text-white/66',
    field: 'border-white/24 bg-white/8 text-white placeholder:text-white/40',
    button: 'night',
  },
};

export function NewsletterSignup({
  outcome = null,
  tone = 'day',
  className,
}: NewsletterSignupProps) {
  const palette = PALETTE[tone];
  const answer = outcome === null ? null : newsletterMessage(outcome);

  return (
    // The id is what the action's redirect lands on, so the answer is in view
    // on a phone rather than three screens above the thumb that caused it.
    // `data-tone` is what the stylesheet's focus rule reads: the outline turns
    // white on the dark ground, where the sheet's black one would be invisible
    // on the field and the button both.
    <section
      className={['flex flex-col', className].filter(Boolean).join(' ')}
      data-testid="newsletter"
      data-tone={tone === 'night' ? 'night' : undefined}
      id="news"
    >
      {/* The title size at every width, and not the landing scale's own head.
          This is the quiet thing at the foot of a page whose headline is 80px:
          a 44px "Keep in touch" beside the band above it would read as a second
          proposition rather than as a field to leave an address in. */}
      <h2
        className={`font-display text-title font-semibold tracking-title ${palette.heading}`}
      >
        Keep in touch
      </h2>
      <p className={`mt-2 max-w-[520px] text-body-lg ${palette.body}`}>
        Leave your address and we will write to you when there is news.
      </p>

      <form
        action={joinNewsletter}
        className="mt-6 flex w-full max-w-[560px] flex-col gap-3 sm:flex-row sm:items-center"
      >
        {/* The label is real and visible to a screen reader, and the field
            carries its own placeholder for the eye. A field this wide with its
            label above it would push the button on to a third row at 360. */}
        <label className="sr-only" htmlFor="newsletter-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className={`h-14 min-w-0 flex-1 rounded-full border px-5 text-body outline-offset-2 ${palette.field}`}
          id="newsletter-email"
          inputMode="email"
          maxLength={320}
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
        {/* The button names what it does with the thing beside it, which is the
            rule every other button in this product follows. */}
        <PillButton className="w-full sm:w-auto" type="submit" variant={palette.button}>
          Add my address
        </PillButton>
      </form>

      {answer === null ? null : (
        <p
          className={`mt-4 max-w-[560px] text-body ${answer.done ? palette.body : palette.heading}`}
          data-testid="newsletter-answer"
          role="status"
        >
          {answer.line}
        </p>
      )}

      <p className={`mt-4 max-w-[560px] text-secondary ${palette.caption}`}>{NEWSLETTER_NOTICE}</p>
    </section>
  );
}
