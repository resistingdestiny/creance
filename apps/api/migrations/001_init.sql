-- The Creance schema. DESIGN.md section 4 names eight tables; this is those
-- eight plus the three the index oracle owns from docs/INDEX-SPEC.md section 10,
-- created here so that T12 and T26 find them rather than inventing them.
--
-- Plain SQL rather than an ORM's migrations, because two applications write to
-- this database (apps/api and, from T12, apps/oracle) and a schema owned by one
-- application's model classes is a schema the other has to guess at.
--
-- Conventions:
--   text            ids and enumerations, with CHECK constraints rather than
--                   Postgres enum types, because a CHECK change is not a
--                   migration and an enum change is
--   numeric(78,0)   money and any other on-chain integer; 78 digits covers
--                   uint256 and the PostgreSQL manual recommends numeric for
--                   amounts that have to be exact
--   numeric(8,4)    index values, which the contracts hold as int64 scaled by
--                   1e4, so the scale here matches without a conversion
--   integer         a statistical period as YYYYMM, the same uint32 the
--                   contracts take
--   timestamptz     instants; date for calendar dates

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- The fifteen bindable occupation groups. There is no armed forces series.
-- Writer: migrations only.
CREATE TABLE groups (
  group_key    text PRIMARY KEY,
  label        text NOT NULL,
  bls_series   text NOT NULL,
  picker_order integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Writer: apps/api. One row per Displacement Bond Note series. Everything from
-- attachment_shock to lookback_months is frozen at issuance on chain, so it is
-- read from the chain and cached here rather than being settable.
CREATE TABLE series (
  series_id        text PRIMARY KEY,
  series_key       text NOT NULL,
  group_key        text NOT NULL REFERENCES groups,
  status           text NOT NULL
                   CHECK (status IN ('drafted','issued','subscribing','active',
                                     'claims_open','settling','matured','redeemed')),
  principal        numeric(78,0) NOT NULL CHECK (principal >= 0),
  coupon_rate_bps  integer NOT NULL CHECK (coupon_rate_bps BETWEEN 0 AND 10000),
  attachment_shock numeric(8,4) NOT NULL,
  level_line       numeric(8,4) NOT NULL,
  exhaustion_shock numeric(8,4),
  payout_mode      text NOT NULL CHECK (payout_mode IN ('full','indexed')),
  term_months      integer NOT NULL DEFAULT 12,
  waiting_period_days integer NOT NULL DEFAULT 60,
  grace_period_days   integer NOT NULL DEFAULT 15,
  claim_window_obs_days integer NOT NULL DEFAULT 30,
  claim_window_sep_days integer NOT NULL DEFAULT 60,
  lookback_months  integer NOT NULL DEFAULT 2,
  ats_token        text,
  cover_pool       text,
  collateral_vault text,
  issued_at        timestamptz,
  matures_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (payout_mode = 'full' OR exhaustion_shock IS NOT NULL)
);

-- Writer: apps/api. One row per person, keyed by the World nullifier.
--
-- numeric(78,0) and the DECIMAL rendering of the nullifier, never the hex:
-- World's own integration guide says to convert nullifiers to numbers, and two
-- text rows differing only in hex casing are two identities to a unique index,
-- which is a one-person-two-policies bug no test finds by accident.
CREATE TABLE users (
  nullifier  numeric(78,0) PRIMARY KEY,
  group_key  text REFERENCES groups,
  wallet     text,
  wallet_evm text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

-- Writer: apps/api. The short lived credential a bind is made against. The
-- primary key is the JWT's jti, and consumed_at is what makes an eligibility
-- credential single use: without it, one selfie plus one saved bearer token
-- buys as many policies as the capacity allows.
CREATE TABLE eligibility_credentials (
  jti         text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('eligibility','claim')),
  nullifier   numeric(78,0) NOT NULL REFERENCES users,
  series_id   text REFERENCES series,
  group_key   text REFERENCES groups,
  policy_id   text,
  wallet      text,
  wallet_evm  text,
  presence    boolean NOT NULL DEFAULT false,
  issuer      text NOT NULL,
  issued_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'claim' OR series_id IS NOT NULL)
);
CREATE INDEX eligibility_credentials_by_nullifier
  ON eligibility_credentials (nullifier, kind, issued_at DESC);

-- Writer: apps/api. cover_limit, not limit: limit is a reserved word in SQL and
-- quoting it forever is a tax. The JSON field stays `limit` and is mapped.
CREATE TABLE quotes (
  quote_id        text PRIMARY KEY,
  series_id       text NOT NULL REFERENCES series,
  group_key       text NOT NULL REFERENCES groups,
  wallet          text NOT NULL,
  wallet_evm      text,
  cover_limit     numeric(78,0) NOT NULL CHECK (cover_limit > 0),
  premium         numeric(78,0) NOT NULL CHECK (premium > 0),
  asset           text NOT NULL,
  asset_decimals  integer NOT NULL,
  annual_rate_bps integer NOT NULL,
  pricing_basis   jsonb NOT NULL,
  issued_via      text NOT NULL CHECK (issued_via IN ('x402','credential','open')),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  policy_id       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Writer: apps/api.
CREATE TABLE policies (
  policy_id      text PRIMARY KEY,
  series_id      text NOT NULL REFERENCES series,
  group_key      text NOT NULL REFERENCES groups,
  nullifier      numeric(78,0) NOT NULL REFERENCES users,
  wallet         text NOT NULL,
  wallet_evm     text NOT NULL,
  cover_limit    numeric(78,0) NOT NULL,
  premium        numeric(78,0) NOT NULL,
  asset          text NOT NULL,
  asset_decimals integer NOT NULL,
  status         text NOT NULL CHECK (status IN (
                   'binding','bound','active','payment_failed','lapsed',
                   'claims_open','claimed','under_review','approved','paid',
                   'declined','expired','void')),
  quote_id       text REFERENCES quotes,
  credential_jti text REFERENCES eligibility_credentials,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  claims_payable_from date NOT NULL,
  paid_through   integer NOT NULL,
  next_due       date,
  nft_token_id   text,
  nft_serial     bigint,
  hcs_topic      text,
  hcs_receipt_seq bigint,
  bind_tx_id     text,
  void_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nft_token_id, nft_serial)
);

-- The enforcement point for "one active policy per nullifier per series"
-- (DESIGN.md 3.6). A partial index, not a table constraint: PostgreSQL supports
-- a WHERE on CREATE UNIQUE INDEX and not on UNIQUE (...).
--
-- lapsed, expired, payment_failed and void are outside the predicate, so a
-- person whose cover lapsed can buy again: the rule is one active policy, not
-- one ever. declined is inside it, which is the conservative reading, because a
-- declined claim leaves the policy able to continue and the policy should
-- return to active rather than let a second purchase in beside it.
CREATE UNIQUE INDEX policies_one_active_per_nullifier
  ON policies (nullifier, series_id)
  WHERE status IN ('binding','bound','active','claims_open','claimed',
                   'under_review','approved','paid','declined');

-- Writer: apps/api. status says whether money actually moved: T07 has no
-- payment gate, so the first premium of every policy it binds is written here
-- as uncollected with a null facilitator_tx, and T08 only has to swap the gate
-- in front of the same row.
CREATE TABLE payments (
  payment_id     text PRIMARY KEY,
  endpoint       text NOT NULL,
  payer          text NOT NULL,
  pay_to         text NOT NULL,
  amount         numeric(78,0) NOT NULL,
  asset          text NOT NULL,
  asset_decimals integer NOT NULL,
  scheme         text NOT NULL DEFAULT 'exact',
  network        text NOT NULL DEFAULT 'hedera:testnet',
  facilitator    text,
  facilitator_tx text,
  chain_tx_id    text,
  status         text NOT NULL DEFAULT 'uncollected'
                 CHECK (status IN ('uncollected','settled','failed')),
  ref            text,
  settled_at     timestamptz,
  hcs_topic      text,
  hcs_seq        bigint,
  request_id     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_by_facilitator_tx
  ON payments (facilitator_tx) WHERE facilitator_tx IS NOT NULL;
CREATE UNIQUE INDEX payments_by_chain_tx
  ON payments (chain_tx_id) WHERE chain_tx_id IS NOT NULL;

-- Writer: apps/api. The proof of loss fields are DESIGN.md 3.9: the
-- attestation, the separation, the evidence manifest and the decision record.
-- T13 and T25 fill them; T07 creates them so that neither has to migrate a
-- live database.
CREATE TABLE claims (
  claim_id        text PRIMARY KEY,
  policy_id       text NOT NULL REFERENCES policies,
  series_id       text NOT NULL REFERENCES series,
  nullifier       numeric(78,0) NOT NULL REFERENCES users,
  credential_jti  text REFERENCES eligibility_credentials,
  group_key       text NOT NULL REFERENCES groups,
  status          text NOT NULL CHECK (status IN (
                    'draft','submitted','under_review','approved','declined',
                    'paid','expired','void')),
  employer_name_enc bytea,
  employer_hash   text,
  job_title       text,
  separation_date date NOT NULL,
  separation_type text NOT NULL CHECK (separation_type IN (
                    'layoff','redundancy','position_eliminated','site_closure',
                    'resignation','dismissal_for_cause','fixed_term_end',
                    'client_loss_self_employed')),
  attestation_message_hash text,
  attestation_sig text,
  attestation_method text CHECK (attestation_method IN
                    ('eip191','hedera_sign_message','unsigned_accepted')),
  verified_at     timestamptz,
  packet_hash     text,
  packet_manifest jsonb,
  decision        text CHECK (decision IN ('approve','refer','decline')),
  reasons         text[] NOT NULL DEFAULT '{}',
  confidence      numeric(4,3),
  reviewer        text,
  decision_hash   text,
  amount          numeric(78,0),
  qualifying_month integer,
  claim_deadline  timestamptz,
  authorisation   text,
  authorisation_deadline timestamptz,
  hcs_submitted_seq bigint,
  hcs_decision_seq  bigint,
  paid_tx         text,
  submitted_at    timestamptz,
  decided_at      timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One claim per nullifier per series, ever (DESIGN.md 3.2). The predicate
-- excludes only void, so a declined claim still blocks a second one and a
-- resubmission amends the claim that exists.
CREATE UNIQUE INDEX claims_one_per_nullifier_series
  ON claims (nullifier, series_id)
  WHERE status <> 'void';

-- Writer: apps/api. One row per evidence file. DESIGN.md 4 lists this as a
-- claims column reading "encrypted refs and sha256", which is a table: it is
-- one row per file with its own key material.
CREATE TABLE claim_evidence (
  evidence_id  text PRIMARY KEY,
  claim_id     text NOT NULL REFERENCES claims,
  kind         text NOT NULL,
  filename     text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  sha256       text NOT NULL,
  object_key   text NOT NULL,
  enc_alg      text NOT NULL DEFAULT 'AES-256-GCM',
  enc_iv       bytea NOT NULL,
  enc_tag      bytea NOT NULL,
  enc_dek      bytea NOT NULL,
  enc_kek_id   text NOT NULL,
  uploaded_at  timestamptz NOT NULL,
  frozen_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX claim_evidence_one_per_file ON claim_evidence (claim_id, sha256);

-- The three tables the index oracle owns, from docs/INDEX-SPEC.md section 10.
-- T12 and T26 write them. They are created now so that the schema is one
-- migration rather than two, and so that the API can serve
-- GET /v1/index/:group from observations before the oracle exists.
CREATE TABLE runs (
  id            bigserial PRIMARY KEY,
  mode          text NOT NULL CHECK (mode IN ('live','replay','backfill','scenario')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  state         text NOT NULL CHECK (state IN ('fetch','verify','compute','qa',
                                               'publish','submit','done','failed')),
  target_period integer,
  qa_json       jsonb,
  notes         text
);

CREATE TABLE source_files (
  id          bigserial PRIMARY KEY,
  url         text NOT NULL,
  sha256      text NOT NULL,
  bytes       integer NOT NULL,
  fetched_at  timestamptz NOT NULL,
  stored_path text
);

-- The published index. The API reads it; from T12 the oracle writes it.
--
-- The unique key is (group_key, period, status) rather than (group_key, period)
-- because the first published value settles forever: a later source revision is
-- recorded beside the value that settled, never over it.
CREATE TABLE observations (
  id            bigserial PRIMARY KEY,
  group_key     text NOT NULL REFERENCES groups,
  series_id     text REFERENCES series,
  period        integer NOT NULL,
  u_g           numeric(6,3),
  u_all         numeric(6,3),
  e             numeric(8,4),
  ebar          numeric(8,4),
  odi           numeric(8,4),
  open          boolean NOT NULL,
  open_reason   text CHECK (open_reason IN ('shock','level','both')),
  status        text NOT NULL CHECK (status IN ('final','revised','insufficient_history','no_source')),
  model_version text NOT NULL,
  source        text,
  source_hash   text,
  computed_at   timestamptz NOT NULL,
  sig           text,
  hcs_topic     text,
  hcs_seq       bigint,
  submit_tx     text,
  revises_seq   bigint,
  run_id        bigint REFERENCES runs,
  replay        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_key, period, status),
  CHECK (open = (open_reason IS NOT NULL))
);
CREATE INDEX observations_by_group_period ON observations (group_key, period DESC);

INSERT INTO schema_migrations (version) VALUES ('001_init');

COMMIT;
