-- What the Adjuster and the human review queue need that 001 did not create.
--
-- Writer: apps/api, as everywhere else. The Adjuster is an HTTP client of this
-- API and never opens a connection to this database.
--
-- Four additions, each with the reason it is a column rather than a field
-- squeezed into an existing jsonb.

BEGIN;

-- The auto-approval gate, per series.
--
-- Neither number exists on chain: SeriesTerms freezes the trigger and the
-- windows, which are the terms a policyholder is owed, and says nothing about
-- how much of the adjudication we are willing to automate, which is ours to
-- set and to change. So they live here, per series, with the demo defaults from
-- DESIGN.md 9 item 7: the full 5,000 cover limit, in minor units of a six
-- decimal settlement token.
ALTER TABLE series
  ADD COLUMN IF NOT EXISTS auto_approval_limit numeric(78,0) NOT NULL DEFAULT 5000000000
    CHECK (auto_approval_limit >= 0),
  ADD COLUMN IF NOT EXISTS auto_approval_confidence numeric(4,3) NOT NULL DEFAULT 0.900
    CHECK (auto_approval_confidence BETWEEN 0 AND 1);

-- The decision record, whole.
--
-- Its SHA-256 is on a public topic and is signed over by the CLAIMS role, so
-- the preimage has to be kept exactly as it was hashed. It is its own column
-- rather than a key inside packet_manifest because the manifest describes what
-- was submitted and the record describes what was decided, and a resubmission
-- produces a new manifest and a new record independently.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS decision_record jsonb;

-- The claimant's name, which the attestation of 001 did not carry.
--
-- DESIGN.md 3.9 asks the documents to agree with the attestation "on employer,
-- name and date", and without a name that rule cannot be evaluated at all. It
-- is encrypted at rest beside employer_name_enc, and only its hash goes into
-- the packet manifest, so the strongest check in the packet does not cost a
-- name in the clear.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS claimant_name_enc bytea,
  ADD COLUMN IF NOT EXISTS name_hash text;

-- Which token decided, and whether the signature was checked.
--
-- `reviewer` in 001 holds a human's name. `decided_by` says which actor posted
-- the decision, `adjuster` or `reviewer:<name>`, which is what the audit needs
-- and what the record's `actor` field mirrors.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS decided_by text,
  ADD COLUMN IF NOT EXISTS attestation_verified boolean NOT NULL DEFAULT false;

-- Whether the person ticked the box. Rule R09 in docs/CLAIMS.md needs it and
-- 001 recorded only the signature, which is a different question: a signed
-- message proves who sent it and not that they read what it said.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS statement_accepted boolean NOT NULL DEFAULT false;

-- The queue reads this every few seconds during a demo.
CREATE INDEX IF NOT EXISTS claims_by_status ON claims (status, submitted_at DESC);

-- Rule R29, one query rather than a table: the same file on two claims is the
-- cheapest fraud there is, and this is the index that makes finding it free.
CREATE INDEX IF NOT EXISTS claim_evidence_by_sha256 ON claim_evidence (sha256);

INSERT INTO schema_migrations (version) VALUES ('002_adjuster')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
