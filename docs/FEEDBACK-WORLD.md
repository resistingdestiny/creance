# Feedback for World

Built during ETHOnline 2026. Creance is parametric occupation cover on Hedera
testnet: a person buys cover, and a World Selfie Check is what says they are one
person buying one cover. The check runs twice in the product, at purchase and at
claim, so this integration uses Selfie Check for eligibility, for abuse
prevention and for continuity between the two.

The four sections below are the ones the prize asks for. Every entry says what
we were doing, what we expected, what happened, and the page or endpoint
involved with the date. Entries were written as they were met, not from memory
at the end.

Staging app id: `app_8569aa8d1bbfb24b1243e86d4fc34adc`. RP id:
`rp_d6ae9b4ff2018a15`.

## 1. Selfie Check documentation and integration flow

### The preset returns a 3.0 proof, and the credential's own page does not say so

Date: 5 September 2026. Pages:
`https://docs.world.org/world-id/credentials/11`,
`https://docs.world.org/world-id/idkit/credentials`.

What we were doing: choosing which preset to build on, given that the whole
product depends on a stable per-person identifier.

What we expected: the credential's own page to state its protocol version,
because that is where an integrator lands first.

What happened: the version is stated on the credentials index page and on the
verification-flows page, but not on `/world-id/credentials/11`. It matters more
than a version number normally would: `selfieCheckLegacy` returns World ID 3.0
proofs, so the nullifier is stable per person per action, while a 4.0 uniqueness
proof's nullifier is one-time-use and the stable link is `session_id`. A product
that needs "the same person who bought is the person who claims" gets that from
one of those and not from the other. Suggestion: put the protocol version and
one line about nullifier stability on the credential's own page.

### `allow_legacy_proofs` is required, optional and absent, on three pages

Date: 5 September 2026. Pages: the credentials page's `selfieCheckLegacy`
example, the same page's common-parameters table, the React reference's
`selfieCheckLegacy` example.

The example omits it, the parameter table calls it "required for request flows",
and the React example passes `true`. Three places, two answers. We pass `true`.
Suggestion: make the credentials page's own example match its own table.

### The 90 day inactivity window is not where the claim-time reader is

Date: 5 September 2026. Page: `https://docs.world.org/world-id/credentials/11`.

The credential's validity period is 90 days and the camera flow is repeated
after 90 days without use. That is on the credential page and not in the
integration guide or next to `require_user_presence`, which is where anybody
building a flow with a gap between two verifications is reading. Our gap is up
to twelve months, so every claim in this product is a full capture rather than a
consent tap, and that changes the copy and the demo timing. Suggestion: surface
it beside `require_user_presence`.

### Whether the verify endpoint enforces `require_user_presence` is not stated

Date: 5 September 2026. Pages: the credentials page, the verify OpenAPI.

We ask for presence at claim. Nothing we could read says whether World's verify
endpoint refuses a proof whose `user_presence_completed` is false when the
request asked for presence. We assume it does not and check the flag ourselves
on the proof, which the schema's own wording supports ("IDKit always sends it;
treat a missing value as false"). An integrator who assumes the endpoint
enforces it has a hole and no way to learn that from the docs. Suggestion: say
which side owns the check, in one sentence, on the page that documents the flag.

### `selfie` as an identifier value appears only inside a schema description

Date: 5 September 2026. Page: the verify OpenAPI, `VerifyV4ResponseItemV3`.

The value a backend compares against, and its backward-compatible alias `face`,
are documented in the description of a schema field and in no prose page. We
accept both. Suggestion: name them on the credential page.

### The medium-assurance statement is the best thing on the credential page

Not a complaint. "Does not provide a strict one-person-one-account guarantee and
is considered a medium-assurance verification method" and "returns a proof of
the completed check, not a numeric Sybil or uniqueness score" let us write an
honest security model into our own README instead of overclaiming. So does
"confirm a returning user is the same person who originally enrolled", which is
exactly the continuity property this product needs and is worth naming more
prominently: it is a second use of the credential and it is only findable by
reading the whole page.

## 2. Developer Portal navigation, search, product discovery and debugging

### `app_id` and `rp_id` are two values with two registrations and one explanation

Date: 5 September 2026. Pages: the concepts page's legacy section, the verify
reference, the IDKit configuration reference.

Both appear as path parameters and as configuration. The relationship is
explained in one line of the concepts page's legacy section, "In World ID 4.0,
this is now referred to as RP ID", which reads as though they are the same
thing. They are not: they are separate values from separate registration steps,
and a request needs both. We keep both in configuration and make which one goes
in the verify path a variable, which turned out to be the right shape.
Suggestion: one short page, or one boxed paragraph, that says what each id is,
where it comes from and where each is used.

### Three gates, three queues, three different failure messages

Date: 5 September 2026.

Between a fresh Portal account and a working Selfie Check demo there are three
separate approvals: World ID 4.0 / RP registration, which is self-service and
instant; the Selfie Check feature flag, which is a human at Tools for Humanity;
and Sandbox tester access, which is a human per platform. They are documented in
three places and nothing says they are three. Confusing them costs a day.
Suggestion: one checklist page, "what you need before Selfie Check will return a
proof", with the three gates, who grants each and how to tell which one you are
stuck behind.

### The machine index and the docs MCP server both worked

Not a complaint. `https://docs.world.org/llms.txt` lists every page with a `.md`
twin that returns clean markdown, which made reading the whole Selfie Check
surface fast and quotable. The World Docs MCP server needs no key. Both are
worth advertising more loudly than they are; we found them by looking for them.

### The debugging signal that helped most is undocumented

See section 4: the `attribute` field on error responses.

## 3. Sandbox App states, proof flows, test users, errors and edge cases

This section is the one we can fill least from a headless build session, because
completing a Selfie Check needs a phone with the Sandbox App and a face. What
follows is what was exercised without one, and exactly what is left for the
device run.

### The verify endpoint accepts a real `rp_id` in the path

Date: 5 September 2026. Endpoint:
`POST https://developer.world.org/api/v4/verify/{id}`.

What we were doing: proving the endpoint was reachable and learning which id
form the path takes, before any proof existed.

What we expected: from the endpoint summary, `rp_id` preferred and `app_id`
accepted.

What happened: exactly that. Both `rp_d6ae9b4ff2018a15` and
`app_8569aa8d1bbfb24b1243e86d4fc34adc` passed the path format check and reached
body validation, each answering:

```json
{"code":"validation_error","detail":"action is required for uniqueness proofs","attribute":"action"}
```

Worth recording because probing the same endpoint with synthetic `rp_...` values
before the app existed rejected every shape tried with "Invalid ID format", so
the format check is real and a made-up id is not a useful smoke test. A real one
is: two curl calls with an empty body prove reachability and both id forms in
under a minute, and we recommend that as the first step of any integration.

### `environment: "sandbox"` is accepted in the verify body, and the OpenAPI says it is not

Date: 5 September 2026. Endpoint: the same. Pages: the verify OpenAPI, the
sandbox access page, `@worldcoin/idkit-core` 4.2.4 types.

What we were doing: resolving a contradiction before building for it. The
sandbox access page says to set `environment: sandbox` in IDKit and to send the
proof to the production verify endpoint. The verify OpenAPI declares
`environment` as an enum of exactly `production` and `staging`, in both the
request and the response.

What happened: a body carrying `"environment":"sandbox"` was not rejected. It
passed validation and reached proof verification, answering
`all_verifications_failed` on the synthetic proof exactly as the `staging` body
did. The shipped SDK agrees with the sandbox page and not with the OpenAPI:
`IDKitRequestConfig.environment` is typed `"production" | "staging" |
"sandbox"`. So the OpenAPI enum is behind the product. Suggestion: add `sandbox`
to the verify schema, or say in the schema description that it is accepted and
what it means.

### The proof format error is specific and useful

Date: 5 September 2026. A syntactically valid request with a made-up proof
string answers:

```json
{"success":false,"code":"all_verifications_failed","detail":"All proof verifications failed.",
 "results":[{"identifier":"selfie","success":false,"code":"invalid_format",
 "detail":"This attribute is improperly formatted. Expected either an ABI-encoded uint256[8] string or a JSON-encoded array string in the correct format.","attribute":"proof"}]}
```

That is a good error: it names the field, the expected encodings and the failing
credential. `invalid_format` is not in the documented per-proof code list, so it
is an undocumented code doing a documented job well.

### What is left for the device run, and why it matters

These need the Sandbox App on a phone and are the five results we would most
like to record. Each is written so that whoever runs them knows what to look
for.

1. The raw IDKit result, logged before it is forwarded. Specifically
   `protocol_version`, `environment`, `responses[0].identifier` and whether
   `max_age` is present. `environment` is the answer to the contradiction above,
   from the client side rather than the server side.
2. The same action verified twice by the same account, back to back. Whether the
   second returns a proof with an identical nullifier, or fails
   `nullifier_replayed`, or fails `max_verifications_reached`. This is the most
   consequential unknown in the whole integration and section 4 says why.
3. A request with `require_user_presence: true`. Whether the camera check runs
   and whether `user_presence_completed` comes back true.
4. A second purchase on the same series with the same account, to see our own
   one person one cover refusal on screen with no payment taken.
5. A deliberately wrong signal, to see the widget report `failed_by_host_app`
   when our backend refuses a proof World accepted.

Also worth timing on the device: how long a cold funnel takes against the five
minute `rp_context` default, and how long a fresh sandbox account takes from
install to first proof, because that is the real cost of a demo retake.

## 4. What was confusing, missing, broken or hard to test

### The verify endpoint returns two different error envelopes and only one is documented

Date: 5 September 2026. Endpoint:
`POST https://developer.world.org/api/v4/verify/{id}`. Page: the verify
OpenAPI's `VerifyV4ErrorResponse`, which requires `success`, `code` and
`detail`.

A body-shape rejection carries no `success` field at all, and carries an
undocumented `attribute`:

```json
{"code":"validation_error","detail":"action is required for uniqueness proofs","attribute":"action"}
```

A proof-level rejection does carry it, and matches the documented schema:

```json
{"success":false,"code":"all_verifications_failed","detail":"All proof verifications failed.","results":[...]}
```

Two envelopes from one endpoint. The consequence is sharp: a handler written as
`if (body.success === false) reject()` passes a validation error straight
through as though the proof verified. We decide success from the HTTP status
instead, and we would tell any other integrator to do the same. `invalid_request`
and `validation_error` are not in the documented code list either. Suggestion:
document both envelopes, and document `attribute`, which is the single most
useful debugging field in this integration and appears nowhere in the reference.

### The published signing test vectors cannot be run against the published library as shipped

Date: 5 September 2026. Page:
`https://docs.world.org/world-id/idkit/signatures`. Package:
`@worldcoin/idkit-server` 1.1.1, re-exported by `@worldcoin/idkit-core/signing`.

What we were doing: proving our RP signing before building any UI, because
`invalid_rp_signature` names none of the four inputs that went into the message
and is therefore the worst error in the integration to debug live.

What we expected: to feed the published `sign_request` vectors to `signRequest`
and compare.

What happened: `SignRequestParams` is `{ signingKeyHex, action?, ttl? }`. The 32
random bytes and the clock are read from `crypto.getRandomValues` and
`Date.now` inside the function, so there is no seam. We stubbed both globals and
then every published value reproduced exactly: the four `hash_to_field` vectors,
both `compute_rp_signature_message` vectors, and both 65-byte signatures. So the
vectors are correct and the algorithm is deterministic, and a reader still
cannot use them without knowing to monkey-patch two globals. Suggestion: either
accept optional `nonce` and `createdAt` in `SignRequestParams`, or put the
`vi.spyOn` recipe next to the vectors. Published vectors that cannot be run
against the published library are half a test suite.

### The signing helper takes the action as a string, and the docs describe it as a hash

Date: 5 September 2026. Page: the signatures page's message layout. Package:
`@worldcoin/idkit-server` 1.1.1.

The page describes bytes 49 to 80 of the message as `hash_to_field(action)`, so
a reader building the message by hand hashes first. The shipped
`computeRpSignatureMessage(nonceBytes, createdAt, expiresAt, action?)` takes the
action as a plain string and hashes it internally. Passing a pre-hashed value
would produce a message that is wrong in a way nothing reports. Suggestion:
either name the parameter in the docs or show the signature of the helper beside
the layout.

### `hashSignal` hashes a 0x-prefixed string as bytes, not as text

Date: 5 September 2026. Package: `@worldcoin/idkit-core/hashing` 4.2.4.

`hashSignal("0x010203")` equals `hashSignal(new Uint8Array([1,2,3]))`, and both
equal the published `hash_to_field(0x010203)` vector. That is almost certainly
correct and deliberate, for Ethereum addresses. It is also not said anywhere we
could find, and it decides how a signal is hashed for any product whose signal
might be an address. Ours is a Hedera account id and takes the text path, but a
product that switched from an account id to an EVM address would silently change
its signal hashing. Suggestion: one line in the signal documentation.

### The nullifier storage advice is good and should be louder

Not a complaint. The integration guide says to convert nullifiers from hex to
numbers before storing them, "to avoid parsing and casing issues that can lead
to security vulnerabilities", and even names the Postgres type. Two rows
differing only by hex casing are two people to a text index, which is one person
with two covers, and no test catches that by accident. We store
`numeric(78,0)` and put the decimal form in our own credential. This is the kind
of advice that belongs in a callout, not a sentence.

### Selfie Check needs continuity, and the guidance for continuity is 4.0 only

Date: 5 September 2026. Pages: the 4.0 migration guide, the credentials page,
the session documentation.

This is the sharpest thing this build can tell World, and we only found it by
using two products together.

Selfie Check returns 3.0 proofs. Its own page names continuity, "confirm a
returning user is the same person who originally enrolled", as a use. Our
product is exactly that: a person buys cover in month one and claims in month
eight, and the whole value of the credential is that both are the same person.

The 4.0 migration guide calls apps that verify the same action before each claim
"an anti-pattern of World ID" and points them at Session Proofs. Session Proofs
are 4.0 only. Selfie Check is 3.0 only. So a Selfie Check integration that needs
continuity, which is a use World advertises for the credential, has no supported
path other than the one the migration guide discourages. Meanwhile the IDKit
error table carries `nullifier_replayed` and `max_verifications_reached`, which
imply a repeat verification of one action can be refused outright, while the
integration guide says our backend owns uniqueness and the Portal only confirms
cryptographic validity. Whether an action still has a max-verifications setting
under 4.0, and whether it applies to legacy 3.0 proofs, is not documented
anywhere we read.

Suggestion, in order of usefulness: say on the Selfie Check page what the
supported continuity pattern is for a 3.0 credential; say whether repeat
verification of one action is supported or capped; and if the answer is that
Selfie Check will gain session support, say when, because products are being
designed around the gap today.

### The gates are human approvals with no published turnaround

Date: 5 September 2026.

The Selfie Check feature flag and Sandbox tester access are both human
approvals, both gate any demo of this credential, and neither publishes a
turnaround. For a hackathon that is a scheduling risk you can only manage by
requesting both before you start, which is not obvious from any page.
Suggestion: state a typical turnaround, even a wide one.
