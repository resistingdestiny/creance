-- Experience bands.
--
-- Cover is sold in three bands of years of experience, 0 to 5, 5 to 25 and 25
-- or more. The band moves the market half of the price and nothing else: the
-- trigger, the settlement and the payout are identical in all three, because
-- the index has no occupation-by-age series to measure a seniority difference
-- with. apps/api/src/capacity.ts carries the whole argument and
-- docs/DECISIONS.md records it.
--
-- Writer: apps/api, as everywhere else.
--
-- Three changes, and the nullability of the first two is the backwards
-- compatibility decision rather than an oversight.

BEGIN;

-- The band a quote was priced in and the band a policy was written in.
--
-- Nullable, and null means "named no band". Every policy bound before this
-- migration has one, including the published example cover, and those covers
-- keep working exactly as they did: their trigger and their payout never
-- depended on a band and their exposure sits against the capital that named no
-- band either. A null is not a fourth band and it is not a default: it is the
-- honest record of a purchase made when the question was not asked.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS band text CHECK (band IN ('0_5','5_25','25_plus'));
ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS band text CHECK (band IN ('0_5','5_25','25_plus'));

-- Capital committed to a (series, band) rather than to a series.
--
-- The vault takes a subscription against a series and knows nothing of bands,
-- and it cannot be redeployed under live cover, so which band a subscription
-- will take is recorded here beside it. `chain_tx` is the vault subscription it
-- belongs to where there is one; it is nullable because an allocation can be
-- made against principal that is already in the vault, and a row that claimed a
-- transaction it did not have would be worse than a row that admits it has none.
--
-- Principal with no row here is unallocated, and unallocated principal stands
-- behind all three bands, because capital that named no band is capital that
-- will take any band. That is what keeps every price identical to what it was
-- before this migration until real capital says otherwise.
CREATE TABLE IF NOT EXISTS band_subscriptions (
  subscription_id text PRIMARY KEY,
  series_id       text NOT NULL REFERENCES series,
  band            text NOT NULL CHECK (band IN ('0_5','5_25','25_plus')),
  holder          text NOT NULL,
  amount          numeric(78,0) NOT NULL CHECK (amount > 0),
  chain_tx        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS band_subscriptions_by_series
  ON band_subscriptions (series_id, band);

-- The exposure side of the same sum, which is a group-by over live policies.
CREATE INDEX IF NOT EXISTS policies_by_series_band
  ON policies (series_id, band) WHERE band IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('005_bands')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
