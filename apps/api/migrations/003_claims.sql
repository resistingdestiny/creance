-- What the claim submission path needs that 001 and 002 did not create.
--
-- Writer: apps/api. Three columns and one index, all on `claims`.

BEGIN;

-- The nullifier the claim-time check returned.
--
-- docs/DECISIONS.md, T11 "One action or two, and what that costs the claim":
-- when WORLD_ACTION_ELIGIBILITY and WORLD_ACTION_CLAIM name one registered
-- action, the claim's check returns the policy's own nullifier and there is
-- nothing to store. When they name two, the same person gets a different
-- number at claim, `claims.nullifier` still holds the policy's, and
-- "one claim per person per series, ever" has to be enforced on the claim's.
--
-- Nullable, because a deployment running one action writes nothing here, and
-- the partial index below then enforces nothing rather than enforcing it on a
-- column of nulls. GET /healthz reports which regime is running.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS claim_nullifier numeric(78,0);

CREATE UNIQUE INDEX IF NOT EXISTS claims_one_per_claim_nullifier_series
  ON claims (claim_nullifier, series_id)
  WHERE claim_nullifier IS NOT NULL AND status <> 'void';

-- What the live person check actually returned, rather than what was asked for.
--
-- Rules R01 and R03 in docs/CLAIMS.md are "a live person check was completed"
-- and "the check was made for the claim action". Requesting
-- `require_user_presence` and receiving a proof that completed one are two
-- different facts, and 002 gave the Adjuster neither: the admin payload
-- derived presence from `verified_at` being set and named the action from a
-- constant. Both are stored now, so a rule reads what happened.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS world_action text,
  ADD COLUMN IF NOT EXISTS world_presence boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('003_claims')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
