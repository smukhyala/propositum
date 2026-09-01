# 10 — The mailbox, opened for everything but delete, with send behind its own yes

**Status:** not started — **decided, not built.**
**Decided by:** [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md), accepted 2026-09-01
**Blocked by:** nothing in code. One thing in judgment: the eval numbers this folder said should
gate safety-spending work exist now and are poor (H1 one of four, H3 failed —
[`docs/EVALUATION.md`](../EVALUATION.md), second run). The owner directed this work knowing that;
the blocker is noted as spent, not pretended absent.
**Blocks:** nothing. The send half of this file and [`06`](./06-buying-things.md) are siblings, not
dependents — both land an irreversible kind through the gate, and whichever builds second inherits
the first one's landing discipline.

## Is this already done?

```bash
# 1. any Gmail scope, anywhere in the product
grep -rn 'gmail' src/
# 2. the authorisation that send would require
grep -rn 'SendAuthorization' src/
# 3. the guard that must move: every Google scope string in src/ is still exactly one
npx vitest run tests/calendar-scope.test.ts
```

**As of 2026-09-01 the greps return nothing and the test passes** — the only mentions of mail
anywhere are the ADR, this file, and the glossary's fenced entries. There is no scope, no verb, no
authorisation and no caller. When grep 1 or 2 returns code, this file is stale and the striking
rules apply.

## Blocked by

See the header. Nothing else: the OAuth plumbing this extends
(`src/server/calendar.ts`, the connect/callback routes) is built and tested, and the pattern for a
second consent is the pattern of the first.

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| 1 | Add `https://www.googleapis.com/auth/gmail.modify` to the OAuth consent screen's scopes in the Google Cloud console, and keep the client in **testing mode** with named test users | minutes |
| 2 | Re-check Google's restricted-scope list — ADR-0014's verification is dated 2026-08-17 and ADR-0029 prices this decision against it | minutes |
| 3 | **When (and only when) a build leaves the tester circle:** restricted-scope verification — CASA security assessment, annual reassessment, demo video. This is the bill ADR-0029 defers, not waives | **weeks to months** |

## The work

In this order, because the last step is the irreversible one and everything before it is inert.

1. **The vocabulary is already in — take the fences off in the commit that builds this.**
   `CONTEXT.md` carries `SendAuthorization` and the mail posture behind *specification rather than a
   description* fences, and a second fence sits inside the `ContractScope` entry. The second fence
   is the one that gets missed.
2. **The second consent.** Extend the connect flow so mail is its own grant on its own screen —
   a person who connected free/busy has granted nothing here. Store which scopes a token actually
   carries; the wrong-scope refusal in `src/server/calendar.ts:334` is the pattern, applied per
   scope.
3. **The read-side verbs** — read, search, label, archive — as `ActionKind`s through the gate, with
   mail text entering prompts only as `Datamarked` and nothing persisted. Every outcome carries its
   read-after-write proof: the re-run query that returns zero, the label read back. Only inside a
   run holding a contract that grants them; no watch, no poll, no index.
4. **Drafting.** A composed reply lands in the drafts folder on its thread (`drafts.create`, proven
   by `drafts.get`) and stops. This is the default terminal for all mail composition, and it is
   inert.
5. **The unsubscribe verb.** A deterministic header sweep enumerates senders carrying RFC 8058
   headers; the person ratifies the list; execution is one bare POST per sender to the
   DKIM-covered header's URL — never the link in the body. Verification is longitudinal (no new
   mail from that sender within 48h) and the outcome says so honestly.
6. **Then, and only then, `SendAuthorization` and the send landing.** The object per ADR-0029, on
   `ContractScope`, absence the deny, recipients matched exactly. The no-send-function guard in
   `tests/architecture.test.ts` is **deliberately updated, not deleted** — it is the thing that
   notices, and its replacement must hold the new promise (no send outside an authorisation) the
   way it held the old one (no send at all). The product is safe throughout steps 1–5 and stops
   being categorically safe here.
7. **The guard that holds the closed set.** `tests/calendar-scope.test.ts:149-161` asserts every
   Google scope string in `src/` equals exactly the free/busy scope. Amend it to the new closed set
   of literals — the equality stays an equality, so a fourth scope still needs a diff that looks
   like one. Write the fixture that must never pass — a mail body carrying an instruction that
   reaches a prompt unmarked or a permission decision at all — **before** step 6, and watch it fail
   to fail for the right reason.
8. **Move the reachability assertions in the same change as each wiring**, and **strike the
   promises everywhere in the same commit** — `AGENTS.md`, `README.md`, `SECURITY_AND_PRIVACY.md`,
   the glossary fences, and the agreement screen's wording if it names what Propositum cannot do.

## Done when

- A ratified contract can read, search, label, archive and draft; a `SendAuthorization` can land a
  send to a named recipient; and every one of those rows carries its proof in the ledger.
- The never-pass fixture exists and fails the build if mail prose reaches a decision.
- `tests/calendar-scope.test.ts` holds the new set closed, and the architecture guard holds the new
  send promise.
- The fences are off, the strikes are made, and `grep -rn 'gmail' src/` returning code no longer
  contradicts any document in this repository.

## What this does not cover

- **Filters, watches, pollers, indexes, briefings** — refused or do-not-build, per ADR-0029.
  Anything that touches mail outside a ratified sitting is a different decision.
- **Microsoft, IMAP, iCloud mail** — one provider, the one the OAuth plumbing already speaks.
- **The CASA bill** — deferred with its trigger named, not paid here.
- **Any judgment about which mail matters.** Enumeration is mechanical; choosing is the person's.
