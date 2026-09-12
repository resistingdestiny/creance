-- The newsletter list: an address somebody gave us, and when they gave it.
--
-- Writer: apps/api. One row per address.
--
-- Two columns and no third. There is no name, no source page, no IP address,
-- no user agent and no marketing consent flag, because the product does not
-- need any of them to write to somebody once and asking for them would be
-- collecting what we cannot justify holding. The address is the whole record.
--
-- The address is the primary key, stored folded to lower case by the route, so
-- a person who signs up twice makes one row rather than two. That is also what
-- lets the endpoint answer a repeat exactly as it answers a first: the insert
-- is ON CONFLICT DO NOTHING, the response says nothing about which of the two
-- happened, and so the endpoint cannot be used to find out whether a given
-- address is already on the list.
--
-- `created_at` is the first time it was given and is never moved by a repeat,
-- for the same reason: an updated timestamp would be a record of the second
-- submission, which is a thing about a person we said we were not keeping.

BEGIN;

CREATE TABLE IF NOT EXISTS newsletter_signups (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('006_newsletter')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
