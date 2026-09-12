import { PillButton } from '../../components/pill-button';
import { StatusPill } from '../../components/status-pill';
import { TextLink } from '../../components/text-link';
import { formatDayWithYear, formatWholeMoney } from '../../lib/format';
import type { OfferView, OrderBookView } from '../../lib/investor-api';
import {
  isoDay,
  marketOutcomeMessage,
  offersForSeries,
  takeState,
  type MarketOutcome,
} from '../../lib/investor-model';
import { offerNotes, takeOffer, withdrawOffer } from './market-actions';

/**
 * The secondary market, as controls.
 *
 * A noteholder can put a lot of notes on the market, withdraw the offer, and
 * take somebody else's. All three are real writes against the venue on Hedera
 * testnet, made by src/app/invest/market-actions.ts, and every one of them
 * settles or is refused on chain.
 *
 * Everything here is a plain form. The investor screens are server rendered and
 * carry no client JavaScript, and a market ought to be the last place to start:
 * a form works before hydration, it works with JavaScript off, and the answer
 * comes back as a fresh render of the page with the book as it now stands
 * rather than as a number a script patched in. The answer to a write is a
 * redirect carrying a code, and MarketOutcomeBanner turns the code into the
 * sentence.
 *
 * The refusal is the interesting control, not the sad path. The note keeps its
 * own register of who may hold it. The API asks the note before it signs, and
 * the note reverts the transfer leg on the same rule if a call gets past, so a
 * buyer without a place on that register cannot take an offer by any route.
 * The screen shows that as the note's answer rather than as the app failing,
 * because it is the compliance control doing exactly its job.
 */

/** What a write did, in the product's own words. Nothing here comes off the wire. */
export function MarketOutcomeBanner({ outcome }: { outcome: MarketOutcome }) {
  const { done, line } = marketOutcomeMessage(outcome);
  return (
    <div
      className="mt-6 flex flex-col items-start gap-2 rounded-2xl border border-hairline bg-surface p-4"
      data-testid="market-outcome"
      role="status"
    >
      <StatusPill state={done ? 'covered' : 'watch'}>
        {done ? 'Settled' : 'Not settled'}
      </StatusPill>
      <p className="max-w-[640px] text-body text-ink">{line}</p>
    </div>
  );
}

/**
 * Put notes on the market.
 *
 * A native disclosure, shut on load, so the form is not the loudest thing on a
 * page about holdings. The units field is capped at what the account actually
 * holds, which is a read and not a guess, and both fields are whole numbers
 * because the book is quoted in whole notes at whole prices.
 */
export function SellNotes({
  seriesId,
  units,
  compact = false,
  back = 'series',
}: {
  seriesId: string;
  /** Whole notes held, which is the most that can be offered. */
  units: string;
  /** Inside a card, where the disclosure has no room for a heading. */
  compact?: boolean;
  /** Which screen this form is on, so the answer comes back to it. */
  back?: 'board' | 'series';
}) {
  const held = Number(units);
  if (!Number.isFinite(held) || held <= 0) return null;
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body text-ink underline-offset-[3px] hover:underline [&::-webkit-details-marker]:hidden">
        {compact ? 'Sell' : 'Sell notes'}
      </summary>
      <form action={offerNotes} className="mt-3 flex flex-wrap items-end gap-3">
        <input name="series" type="hidden" value={seriesId} />
        <input name="back" type="hidden" value={back} />
        <Field id={`${seriesId}-units`} label="Notes" max={held} name="units" value="1" />
        <Field id={`${seriesId}-price`} label="Price each" max={1_000_000} name="price" value="" />
        <PillButton type="submit" variant="secondary">
          Offer for sale
        </PillButton>
      </form>
    </details>
  );
}

function Field({
  id,
  label,
  max,
  name,
  value,
}: {
  id: string;
  label: string;
  max: number;
  name: string;
  value: string;
}) {
  return (
    <span className="flex flex-col gap-1">
      <label className="text-secondary text-ink-2" htmlFor={id}>
        {label}
      </label>
      <input
        className="h-11 w-28 rounded-xl border border-hairline bg-canvas px-3 text-body tabular-nums text-ink"
        defaultValue={value}
        id={id}
        inputMode="numeric"
        max={max}
        min={1}
        name={name}
        required
        step={1}
        type="number"
      />
    </span>
  );
}

/** Take an offer back off the market. Only the account that made it can. */
export function WithdrawButton({
  offer,
  back = 'series',
}: {
  offer: OfferView;
  /** Which screen this form is on, so the answer comes back to it. */
  back?: 'board' | 'series';
}) {
  return (
    <form action={withdrawOffer}>
      <input name="offer" type="hidden" value={offer.offer_id} />
      <input name="back" type="hidden" value={back} />
      {offer.series_id === null ? null : (
        <input name="series" type="hidden" value={offer.series_id} />
      )}
      <PillButton type="submit" variant="secondary">
        Withdraw
      </PillButton>
    </form>
  );
}

/**
 * The book for one series: what can be taken now, and what has changed hands.
 *
 * Every figure is the venue's own record. There is no bid side, no depth and no
 * volume, because the contract holds offers to sell and fills of them and
 * nothing else, and a chart of a book that does not exist would be a drawing.
 * A fill is the one thing here that is history rather than intent, so it is the
 * one that carries a link to the chain.
 */
export function OfferBook({
  book,
  seriesId,
  address,
  held,
}: {
  book: OrderBookView | null;
  seriesId: string;
  /** The account the screen speaks for, which decides what it may take. */
  address: string;
  /** Whole notes this account holds of the series, for the sell form. */
  held: string | null;
}) {
  const { open, filled } = offersForSeries(book, seriesId);
  const canSell = held !== null && Number(held) > 0;
  if (book === null || (open.length === 0 && filled.length === 0 && !canSell)) return null;

  return (
    <section className="mt-12 flex flex-col gap-4">
      <h2 className="text-body-lg font-medium text-ink">On the market</h2>

      {open.length === 0 ? (
        <p className="text-body text-ink-2">No notes are on offer today.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((offer) => (
            <li
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-hairline p-4"
              key={offer.offer_id}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-body text-ink">
                  <span className="tabular-nums">{offer.units_whole}</span>
                  {Number(offer.units_whole) === 1 ? ' note at ' : ' notes at '}
                  <span className="tabular-nums">
                    {formatWholeMoney(
                      BigInt(offer.price_per_unit.amount),
                      offer.price_per_unit.decimals,
                    )}
                  </span>
                  {' each'}
                </span>
                <span className="text-caption tabular-nums text-ink-2">
                  {formatWholeMoney(BigInt(offer.price.amount), offer.price.decimals)} in all, from{' '}
                  {offer.seller.account_id ?? offer.seller.address}
                </span>
              </span>
              <Take address={address} offer={offer} />
            </li>
          ))}
        </ul>
      )}

      {canSell ? <SellNotes seriesId={seriesId} units={held} /> : null}

      {filled.length === 0 ? null : (
        <div className="mt-2 flex flex-col gap-2">
          <h3 className="text-secondary text-ink-2">Changed hands</h3>
          <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
            {filled.map((offer) => (
              <li
                className="flex flex-wrap items-center justify-between gap-4 py-3"
                key={offer.offer_id}
              >
                <span className="text-body text-ink">
                  <span className="tabular-nums">{offer.units_whole}</span>
                  {Number(offer.units_whole) === 1 ? ' note at ' : ' notes at '}
                  <span className="tabular-nums">
                    {formatWholeMoney(
                      BigInt(offer.price_per_unit.amount),
                      offer.price_per_unit.decimals,
                    )}
                  </span>
                  {' each'}
                  {offer.closed_at === null ? null : (
                    <span className="text-ink-2">
                      {', '}
                      {formatDayWithYear(isoDay(offer.closed_at))}
                    </span>
                  )}
                </span>
                <TextLink href={offer.hashscan} rel="noreferrer" target="_blank">
                  HashScan
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {book.market === null ? null : (
        <p className="text-caption text-ink-2">
          Offers and fills are held by a contract on Hedera testnet.{' '}
          <TextLink href={book.market.hashscan} rel="noreferrer" target="_blank">
            {book.market.contract_id ?? book.market.address}
          </TextLink>
        </p>
      )}
    </section>
  );
}

/**
 * The control on an open offer, or the reason there is not one.
 *
 * A refusal is worded as the note's, because it is: `buyer_eligibility` is what
 * the API read off the note's own register, and a fill would be refused there
 * before anything was signed. An account looking at its own offer is not
 * refused at all and is given the way to withdraw it instead.
 */
function Take({ address, offer }: { address: string; offer: OfferView }) {
  const state = takeState(offer, address);
  if (state === 'closed') return null;
  if (state === 'own') return <WithdrawButton offer={offer} />;
  if (state === 'take') {
    return (
      <form action={takeOffer}>
        <input name="offer" type="hidden" value={offer.offer_id} />
        {offer.series_id === null ? null : (
          <input name="series" type="hidden" value={offer.series_id} />
        )}
        <PillButton type="submit">Take</PillButton>
      </form>
    );
  }

  /* The refused case keeps its button.
     
     Saying so first and then letting the press happen is deliberate. The note
     is what refuses, not this screen, and a control that vanished would put
     this app's guess in place of the note's answer: a reader would have only
     our word that a transfer would have failed. Pressing it asks the note, the
     API reads the register and refuses before it signs anything, and the
     sentence that comes back is the refusal itself. It is drawn as the
     secondary and stands under the warning, so nothing here pretends the press
     is likely to work. */
  return (
    <span className="flex max-w-[340px] flex-col items-start gap-2">
      <StatusPill state="watch">Not approved</StatusPill>
      <span className="text-caption text-ink-2">
        This note keeps its own register of who may hold it, and your account is not on it.
      </span>
      <form action={takeOffer}>
        <input name="offer" type="hidden" value={offer.offer_id} />
        {offer.series_id === null ? null : (
          <input name="series" type="hidden" value={offer.series_id} />
        )}
        <PillButton type="submit" variant="secondary">
          Take
        </PillButton>
      </form>
    </span>
  );
}
