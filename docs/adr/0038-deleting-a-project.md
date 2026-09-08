# ADR-0038 — Deleting a project, and the difference between immutability and retention

**Status:** accepted · 2026-09-08 — ~~decided, not built~~ **built the same day.**
`src/persistence/repositories/index.ts` (`deleteWithEverything`), `src/server/actions.ts`
(`deleteProject`), the project screen, and `tests/delete-project.test.ts`
**Amends:** [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md)'s *Retention and deletion*
section, whose promise about deleting a `Project` was struck on 2026-09-07 for describing neither a
capability nor a behaviour
**Depends on:** [ADR-0010](0010-acting-in-the-browser.md)'s retention section — *"a no-DELETE
trigger and a sweep cannot both be true"*, which is this decision's whole argument one table wider ·
[ADR-0003](0003-artifact-versioning-ledger.md) — the append-only ledger, whose guarantee this
narrows deliberately
**Answers:** the question [ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) opened and
declined to close: an `ExternalEvent` belongs to no `Project`, cannot be swept, and is durable until
the database file goes

## The sentence that stops being true

> Everything Propositum has recorded about a project stays until you delete the database file.

That is the honest sentence `SECURITY_AND_PRIVACY.md` was corrected to on 2026-09-07, after two
checks: **nothing in the product deletes a `Project`**, and the schema declares no cascade anywhere,
so a required relation takes Prisma's default of `Restrict` and a delete would be **refused** rather
than cascading. The document had been promising a tidy outcome for work nobody could start.

After this it becomes *until you delete the project, or the file*. What it costs is stated in the
next section rather than at the end, because it is a real narrowing of the strongest storage
guarantee this product has.

## Context

A person can accumulate projects they do not want a record of — a job search, a health question, a
relationship. Propositum's whole posture is that this data is theirs and stays on their machine, and
`SECURITY_AND_PRIVACY.md` opens by saying so. A local-first product whose answer to *"remove this"*
is *"delete everything you have ever done"* is not honouring that posture; it is relying on the
person having nothing else worth keeping.

The reason there is no delete is not that anybody decided against one. It is that ~~**thirteen
tables** carry~~ **fourteen tables carried** a no-`DELETE` trigger, and a cascade through them
aborts. Nobody chose that as a deletion policy; it is what an append-only ledger does when a delete
arrives, and the policy question was never asked.

*(**Thirteen was wrong when this was written, 2026-09-08.** `external_event` arrived from ADR-0034
the same day and the count was taken without it. Corrected rather than quietly fixed because it is
exactly the failure `AGENTS.md` names — *"never add a count you have to maintain by hand"* — and it
went stale inside a single day. `REQUIRED_GUARDS` in `src/persistence/append-only.ts` is the thing
that knows, and it carries no number.)*

## Decision

**A person may delete a `Project`, and it takes everything filed under it. The tables it owns move
from three append-only guards to two — no-`UPDATE` and no-`REPLACE` stay, no-`DELETE` goes.**

The argument is already written down in `src/persistence/append-only.ts`, about `ActionEvidence`,
and it generalises without a word changed:

> **Immutability is about rewriting history. Retention is about how long history is kept. Only the
> second needs `DELETE`.**

`ActionEvidence` shipped with three guards, which made a published retention promise unenforceable
at the storage layer while a green suite read as though it were enforced. That is this situation
exactly, one table wider and with the promise struck rather than unenforceable.

**What is preserved, and it is the half that was ever load-bearing.** Nothing can rewrite a row.
Nothing can replace one. An `ActionIntent` still cannot be edited after the fact, a `DocumentVersion`
still cannot be altered, and a `ChangeVerdict` still records what a person decided. The ledger is
still a receipt. What changes is that a person can throw the receipt away — **all of it, for one
project, in one act** — rather than editing a line of it.

**Five properties, each a way to get this wrong.**

1. **Whole projects only.** There is no per-row, per-session or per-event delete, and there must not
   be: a ledger you can remove one line from is a ledger you can rewrite by subtraction, which is
   the guarantee this ADR keeps. The unit is the thing a person recognises as *"that piece of work"*.
2. **A person, and a confirmation that names what goes.** Not a sweep, not a retention window, not a
   policy. The screen says how many sittings, documents and recorded actions are about to go, because
   the count is the only thing that makes the act reviewable.
3. **One transaction, or none of it.** A half-deleted project is worse than an undeleted one: it
   leaves an Intention with no Project, which is already reachable today and renders on no screen.
4. **`ExternalEvent` goes with the Intention.** It hangs off an `Intention` rather than a `Project`,
   which is why ADR-0034 could not answer this on its own. `onDelete: Restrict` becomes a delete the
   cascade performs in order rather than a refusal.
5. **It is not undo.** Nothing is archived, nothing is soft-deleted, and there is no bin. A delete
   that keeps the data is the failure this decision exists to fix, wearing a reassuring word.

## Rejected alternatives

**Leave it, and say the file is the unit.** The status quo, and it has the merit of being simple and
already true — `SECURITY_AND_PRIVACY.md` says it plainly now. Refused because it scales the wrong
way: the person it fails is the one with three projects who wants one gone, and telling them to
delete the other two is not a privacy answer. It is also the option that quietly punishes the
product's own success, since the longer somebody uses it the more the file costs to throw away.

**A soft delete — a `deletedAt` column, hidden from every screen.** The smallest diff and it keeps
every guard. Refused because it would make the product's central privacy claim false. A row that says
*deleted* is not deleted; it is a record of the thing plus a record that somebody wanted it gone,
which is strictly more than was there before. This repository already refuses that shape once, in
`ambient-store.ts`'s sentence about a durable row nobody accepted.

**Drop the triggers, delete, recreate them.** Mechanically the least invasive: the guards stay
declared and yield for one statement. Refused because the guarantee becomes *"we remember to put it
back"*, and `prisma db push` already demonstrates what happens when that is the arrangement — it
silently drops triggers on any table rebuild, which is why they are reinstalled and **verified** at
every startup. A window in which the ledger is unguarded, opened deliberately, is worse than one
opened by accident, because nobody will be looking for it.

**Export, then delete.** A good idea and a separate one. It is a feature about getting data out, and
attaching it here would make deletion wait on it.

## What this costs

- ~~**Thirteen tables lose a guard**~~ **Fourteen**, and the count is the cost. Each was
  three-of-three and becomes two-of-three. `tests/append-only.test.ts` asserts two rather than three
  for them, and a reader scanning that file will see a weaker shape than the one that was there.

## What building it found, that this decision had wrong

**Prisma resolves a mis-ordered delete by nullifying, not by refusing** *(added 2026-09-08, from
`tests/delete-project.test.ts`)*. Property 3 above was written believing that a foreign key would
abort a bad cascade, which is why *"one transaction, or none of it"* reads as a safety net. It is
not one. `PRAGMA foreign_keys` is on, but for an **optional** relation Prisma's default is `SetNull`
and Prisma performs the nullification itself: deleting the parent silently writes NULL into every
child's foreign key. Measured — deleting an `Intention` a `WorkSession` still named left the session
in place with `intentionId: null` and raised nothing at all.

Three consequences, and none of them changes the decision:

1. **The cascade order is load-bearing rather than tidy.** There are eleven optional relations in
   this subtree, and a statement in the wrong place quietly edits a row it does not own.
2. **On an append-only table the nullification is an `UPDATE`, and the guard that did NOT go aborts
   it.** `ObservationEvent.approvedSourceId` is the case, and it is a pleasing one: the trigger this
   ADR kept is what enforces the ordering of the deletes this ADR permitted.
3. **One state is refused rather than resolved.** A sitting in another project naming this project's
   `Intention` would be detached by nullification — one project's delete editing another's work. The
   repository checks for it before the transaction opens and throws. Nothing produces that state
   today; a loud refusal on it is cheap, and the alternative is found months later by somebody
   wondering where a sitting's Intention went.
- **The strongest thing this storage layer could say about itself gets a qualifier.** *"Append-only,
  and rows cannot be removed"* becomes *"append-only, and rows are removed only with the project
  they belong to, by a person."* The second is true and is a sentence rather than a shape.
- **A deleted project takes its evidence with it, including evidence about Propositum.** Refused
  `ActionIntent`s are H3 data; `ChangeVerdict`s are H2's denominator. Somebody deleting a project
  deletes measurements, and at n=1 that can be a meaningful fraction of the corpus. That is the
  right trade — it is their data, not the experiment's — and it is worth knowing before a number
  moves for a reason nobody can reconstruct.
- **It is the second time a no-`DELETE` guard has been removed after shipping.** The first was
  `ActionEvidence`. Two is a pattern, and the pattern is that this repository reaches for
  three guards by default and discovers the third was carrying retention rather than immutability.
  The next append-only table should ask which of the two it needs **before** it ships, and that is
  the durable finding here.

## What survives the delete, and is not claimed to

Named here rather than left for somebody to find, because the whole argument for this decision is
that a person can remove *"a job search, a health question, a relationship"*.

- **`thread_message_sent.key` keeps a plaintext subject, and this is the one worth acting on.**
  `signatureOf` is `terms.slice(0, 4).join('+')`, and the phone thread's dedupe key is
  `offer:<signature>` — so a deleted job search can leave `offer:visa+sponsorship+h1b+relocation` in
  a table that belongs to no Project and is not reached by this cascade. `OfferReticence` already
  refuses exactly this shape (*"sha256(salt + ':' + signature)… **never the terms themselves**"*),
  so the repository knows a raw signature is subject-bearing. It is **not fixed here**: the salt
  lives in `install_secret`, which `src/domain/conversation/messages.ts` cannot reach, so it is a
  real change rather than a line. `docs/todo/04-quick-fixes.md` carries it.
- **A `ModelCallRecord` with no run**, which belongs to no project. A boundary name, a model, a
  duration, token counts — no page text and no objective. Tested.
- **`offer_tally` and `google_credential`**, which belong to no project by design. Both were
  justified on the grounds that guarding them would make them undeletable; **that argument is spent**
  — guarding no longer implies undeletable — and what is now true instead is that they are the most
  durable rows in the database, being reached by no delete path at all. Neither holds a subject.

The screen's wording was corrected in the same commit for this reason: it said *"nothing is kept
anywhere else"*, which is nearly true, and nearly true is the wrong register for the confirmation on
an irreversible act.

## What would hold the line

~~Nothing below exists — this is decided and not built, and
[`docs/todo/13-deleting-a-project.md`](../todo/13-deleting-a-project.md) is the work.~~

**Corrected 2026-09-08, hours later — all of it exists**, and todo 13 is struck in the same commit
that struck this. Two rows below did not describe what shipped and are corrected in place rather
than quietly reworded: the two surviving guards are asserted by **suffix** rather than by name, and
*"a delete that fails partway leaves everything"* was never written as a test — what exists asserts
a refusal **before** the transaction opens, which is a different claim.

| | |
|---|---|
| `tests/append-only.test.ts` | The two surviving guards, per table, asserted by name — and that no-`UPDATE` and no-`REPLACE` are still there for every one of them |
| `tests/append-only.test.ts` | An `UPDATE` on a row in a deleted project's table is still refused. Removing the delete guard must not loosen the other two |
| `tests/reachability.test.ts` | Exactly one caller of the delete path, and it is a server action a person reaches from a screen |
| `tests/delete-project.test.ts` | All-or-nothing: a delete that fails partway leaves the project and every row intact |
| `tests/delete-project.test.ts` | An Intention with no Project is not created by this path — the orphan that exists today is what it must not produce more of |

## Revisit when

- **Anybody proposes a per-row or per-session delete.** That is the guarantee this ADR keeps, and it
  needs this one reopened rather than extended.
- **Anybody proposes a soft delete, an archive or a bin.** Same document, and the argument above is
  the one to answer.
- **A third append-only table turns out to need `DELETE` after shipping.** Then the default is wrong
  rather than the table, and what needs writing is guidance about which guards a new ledger takes.
- **Export lands.** Then *delete* and *take it with me* are one flow and the order they run in is a
  decision.
- **Somebody deletes a project and an eval number moves.** The cost bullet above predicts it; seeing
  it is the trigger to decide whether the corpus needs to be held somewhere a person's deletion
  cannot reach.
