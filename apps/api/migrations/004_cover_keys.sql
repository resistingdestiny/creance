-- The cover key: how a person gets back into their own dashboard.
--
-- Writer: apps/api. One row per key issued, and a policy may have more than
-- one over its life, so the policy id is not unique here.
--
-- The key itself is not in this table. What is stored is a SHA-256 digest of
-- it, so a copy of this table opens nothing: a key is a bearer key to one
-- cover, and a table of live bearer keys would be worth stealing. The lookup is
-- still a primary key read, because the digest is what the route computes from
-- what it was handed.
--
-- Why a table rather than a value derived from the policy id. A derived key
-- survives a restart with no schema change, which is the attraction, but the
-- route has to go from the key to the cover and a one way function does not:
-- the policy id would have to be carried inside the key, which makes it long
-- and makes it say which cover it opens before it has been used. See
-- docs/DECISIONS.md.

BEGIN;

CREATE TABLE IF NOT EXISTS cover_keys (
  key_hash   text PRIMARY KEY,
  policy_id  text NOT NULL REFERENCES policies,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cover_keys_policy_id ON cover_keys (policy_id);

INSERT INTO schema_migrations (version) VALUES ('004_cover_keys')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
