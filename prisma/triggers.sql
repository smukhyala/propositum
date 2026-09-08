-- Append-only enforcement for Propositum.
--
-- ── Why this file exists separately from the schema ──────────────────────
--
-- Prisma's SQLite migrations DROP TRIGGERS. The `render_redefine_tables` path
-- does DROP TABLE + rename and recreates INDEXES ONLY — it implements the
-- CREATE INDEX third of SQLite's twelve-step table-rebuild procedure and omits
-- the CREATE TRIGGER part. Exit code 0, data intact, no warning, and the
-- destructive-change checker has no concept of triggers.
--
-- Any dropped column, changed column, added required column, PK change or FK
-- change silently removes every guard below.
--
-- So these are reinstalled AND VERIFIED at every application startup, after
-- `migrate deploy`, by src/persistence/append-only.ts. The guard is a RUNTIME
-- INVARIANT, not a migration artifact. Everything here is idempotent.
--
-- ── Why the REPLACE guard is not redundant ───────────────────────────────
--
-- `INSERT OR REPLACE` deletes the conflicting row and inserts a new one, but
-- `PRAGMA recursive_triggers` defaults OFF, so a DELETE trigger never fires and
-- the row is silently overwritten. Verified. A BEFORE INSERT guard rejecting
-- the REPLACE conflict resolution is the only thing that catches it. That
-- argument is UNCHANGED by what follows, and it is why removing the DELETE
-- guards below did not leave a hole where one used to be: the DELETE trigger
-- was never what stopped a REPLACE.
--
-- ── ~~Three triggers per table.~~ Two, 2026-09-08 ────────────────────────
--
-- [ADR-0038](../docs/adr/0038-deleting-a-project.md): a person may delete a
-- Project, and it takes everything filed under it. The argument is the one
-- `action_evidence` already makes at the bottom of this file, and it
-- generalises without a word changed — **immutability is about rewriting
-- history, retention is about how long history is kept, and only the second
-- needs DELETE.** Nothing here can rewrite a row or replace one. What a person
-- can now do is throw the whole receipt away, for one project, in one act.
--
-- **Every `DROP TRIGGER IF EXISTS` for a delete guard is KEPT and only the
-- CREATE is gone.** That asymmetry is the whole of it, and `action_evidence`
-- set the precedent: a database created before this change still carries the
-- old trigger, and every startup runs this file, so every startup drops it.
-- Without the DROP, deleting a project would succeed on a fresh database and
-- abort on an older one — the worst of the three outcomes, because it is the
-- one nobody can reproduce.
--
-- ── Tables NOT guarded, deliberately ─────────────────────────────────────
--
-- agent_run          mutable by design; it is the claim target and a claim is
--                    a mutation
-- session_reading /
-- session_claim      the human edits these before ratifying a contract
-- handoff_contract   draft -> accepted is a legitimate transition, guarded
--                    separately below (UPDATE permitted only while draft)
-- proposed_change    verdicts live in change_verdict; the change itself is
--                    written once but not security-critical
-- document_version   insert-only by convention; guarded below anyway, because
--                    an edited base would silently invalidate every changeset
--                    hash that points at it
-- action_dispatch    mutable by design; it is the claim target for the browser
--                    control channel, exactly as agent_run is for runs. It is
--                    not evidence — the append-only record of what was
--                    attempted is the action_intent, committed before the
--                    dispatch exists, so a redelivered or abandoned dispatch
--                    changes nothing about what the audit trail says

-- ═══════════════════════════════════════════════════ observation_event

DROP TRIGGER IF EXISTS observation_event_no_update;
CREATE TRIGGER observation_event_no_update
BEFORE UPDATE ON observation_event
BEGIN
  SELECT RAISE(ABORT, 'observation_event is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS observation_event_no_delete;

-- The one that catches INSERT OR REPLACE.
DROP TRIGGER IF EXISTS observation_event_no_replace;
CREATE TRIGGER observation_event_no_replace
BEFORE INSERT ON observation_event
WHEN EXISTS (SELECT 1 FROM observation_event WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'observation_event is append-only: REPLACE forbidden');
END;

-- ═══════════════════════════════════════════════════════ external_event
-- The second ledger (ADR-0034). ~~Same three guards as the first~~ **the same
-- guards as the first, whatever that count is on the day** — it is append-only
-- for the same reason: a row that can be corrected afterwards is a row whose
-- provenance is an opinion. It lost its delete guard with the other thirteen on
-- 2026-09-08, and it hangs off an Intention rather than a Project, which is why
-- ADR-0038 had to name it separately.

DROP TRIGGER IF EXISTS external_event_no_update;
CREATE TRIGGER external_event_no_update
BEFORE UPDATE ON external_event
BEGIN
  SELECT RAISE(ABORT, 'external_event is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS external_event_no_delete;

-- The one that catches INSERT OR REPLACE.
DROP TRIGGER IF EXISTS external_event_no_replace;
CREATE TRIGGER external_event_no_replace
BEFORE INSERT ON external_event
WHEN EXISTS (SELECT 1 FROM external_event WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'external_event is append-only: REPLACE forbidden');
END;

-- ═══════════════════════════════════════════════════════ action_intent

DROP TRIGGER IF EXISTS action_intent_no_update;
CREATE TRIGGER action_intent_no_update
BEFORE UPDATE ON action_intent
BEGIN
  SELECT RAISE(ABORT, 'action_intent is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS action_intent_no_delete;

DROP TRIGGER IF EXISTS action_intent_no_replace;
CREATE TRIGGER action_intent_no_replace
BEFORE INSERT ON action_intent
WHEN EXISTS (SELECT 1 FROM action_intent WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'action_intent is append-only: REPLACE forbidden');
END;

-- ══════════════════════════════════════════════════════ action_outcome

DROP TRIGGER IF EXISTS action_outcome_no_update;
CREATE TRIGGER action_outcome_no_update
BEFORE UPDATE ON action_outcome
BEGIN
  SELECT RAISE(ABORT, 'action_outcome is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS action_outcome_no_delete;

DROP TRIGGER IF EXISTS action_outcome_no_replace;
CREATE TRIGGER action_outcome_no_replace
BEFORE INSERT ON action_outcome
WHEN EXISTS (SELECT 1 FROM action_outcome WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'action_outcome is append-only: REPLACE forbidden');
END;

-- ════════════════════════════════════════════════════ model_call_record

DROP TRIGGER IF EXISTS model_call_record_no_update;
CREATE TRIGGER model_call_record_no_update
BEFORE UPDATE ON model_call_record
BEGIN
  SELECT RAISE(ABORT, 'model_call_record is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS model_call_record_no_delete;

DROP TRIGGER IF EXISTS model_call_record_no_replace;
CREATE TRIGGER model_call_record_no_replace
BEFORE INSERT ON model_call_record
WHEN EXISTS (SELECT 1 FROM model_call_record WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'model_call_record is append-only: REPLACE forbidden');
END;

-- ══════════════════════════════════════════════════════ change_verdict

DROP TRIGGER IF EXISTS change_verdict_no_update;
CREATE TRIGGER change_verdict_no_update
BEFORE UPDATE ON change_verdict
BEGIN
  SELECT RAISE(ABORT, 'change_verdict is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS change_verdict_no_delete;

DROP TRIGGER IF EXISTS change_verdict_no_replace;
CREATE TRIGGER change_verdict_no_replace
BEFORE INSERT ON change_verdict
WHEN EXISTS (SELECT 1 FROM change_verdict WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'change_verdict is append-only: REPLACE forbidden');
END;

-- ════════════════════════════════════════════════════ document_version

-- An edited base would silently invalidate every changeset hash pointing at it,
-- turning refuse-on-drift from a guard into a lie.

DROP TRIGGER IF EXISTS document_version_no_update;
CREATE TRIGGER document_version_no_update
BEFORE UPDATE ON document_version
BEGIN
  SELECT RAISE(ABORT, 'document_version is insert-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS document_version_no_delete;

DROP TRIGGER IF EXISTS document_version_no_replace;
CREATE TRIGGER document_version_no_replace
BEFORE INSERT ON document_version
WHEN EXISTS (SELECT 1 FROM document_version WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'document_version is insert-only: REPLACE forbidden');
END;

-- ═════════════════════════════════════════════════════ handoff_contract

-- Not append-only: draft -> accepted is a legitimate transition. But an
-- ACCEPTED contract is frozen — it is the agreement the human ratified, and the
-- deadline derives from its acceptedAt. A mutable accepted contract would let a
-- crash-restart loop silently reset the budget.

DROP TRIGGER IF EXISTS handoff_contract_frozen_once_accepted;
CREATE TRIGGER handoff_contract_frozen_once_accepted
BEFORE UPDATE ON handoff_contract
WHEN OLD.status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'handoff_contract is frozen once accepted');
END;

-- The delete guard here was CONDITIONAL — accepted contracts only — and it goes
-- with the unconditional ones. The condition was never the argument: an
-- accepted contract is frozen because the deadline derives from its acceptedAt
-- and a crash-restart loop must not reset the budget, and the UPDATE guard
-- above is what holds that. Deleting the project the contract belongs to ends
-- the budget rather than resetting it.
DROP TRIGGER IF EXISTS handoff_contract_no_delete_accepted;

-- ══════════════════════════════════════════════════════════ work_offer
--
-- Insert-only, and written only on acceptance. The reason this table needs
-- guarding at all is narrower than it looks: what it holds is the record of an
-- offer a PERSON AGREED TO, and `grounds` is frozen at that moment precisely
-- because the ambient buffer it came from is bounded by a 30-minute window and
-- will not contain the answer an hour later. An UPDATE here would rewrite why
-- Propositum said it asked — the one thing the person cannot check any other
-- way.

DROP TRIGGER IF EXISTS work_offer_no_update;
CREATE TRIGGER work_offer_no_update
BEFORE UPDATE ON work_offer
BEGIN
  SELECT RAISE(ABORT, 'work_offer is insert-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS work_offer_no_delete;

DROP TRIGGER IF EXISTS work_offer_no_replace;
CREATE TRIGGER work_offer_no_replace
BEFORE INSERT ON work_offer
WHEN EXISTS (SELECT 1 FROM work_offer WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'work_offer is insert-only: REPLACE forbidden');
END;

-- ═══════════════════════════════════════════════════════ shift_outcome

DROP TRIGGER IF EXISTS shift_outcome_no_update;
CREATE TRIGGER shift_outcome_no_update
BEFORE UPDATE ON shift_outcome
BEGIN
  SELECT RAISE(ABORT, 'shift_outcome is insert-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS shift_outcome_no_delete;

DROP TRIGGER IF EXISTS shift_outcome_no_replace;
CREATE TRIGGER shift_outcome_no_replace
BEFORE INSERT ON shift_outcome
WHEN EXISTS (SELECT 1 FROM shift_outcome WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'shift_outcome is insert-only: REPLACE forbidden');
END;

-- ═════════════════════════════════════════════════════ outcome_verdict
--
-- The sibling of change_verdict, and guarded for the identical reason: a
-- verdict is recorded once, and changing your mind has to be an act the
-- interface performs visibly rather than an UPDATE nobody can see afterwards.

DROP TRIGGER IF EXISTS outcome_verdict_no_update;
CREATE TRIGGER outcome_verdict_no_update
BEFORE UPDATE ON outcome_verdict
BEGIN
  SELECT RAISE(ABORT, 'outcome_verdict is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS outcome_verdict_no_delete;

DROP TRIGGER IF EXISTS outcome_verdict_no_replace;
CREATE TRIGGER outcome_verdict_no_replace
BEFORE INSERT ON outcome_verdict
WHEN EXISTS (SELECT 1 FROM outcome_verdict WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'outcome_verdict is append-only: REPLACE forbidden');
END;

-- ════════════════════════════════════════════════ confirmation_request

DROP TRIGGER IF EXISTS confirmation_request_no_update;
CREATE TRIGGER confirmation_request_no_update
BEFORE UPDATE ON confirmation_request
BEGIN
  SELECT RAISE(ABORT, 'confirmation_request is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS confirmation_request_no_delete;

DROP TRIGGER IF EXISTS confirmation_request_no_replace;
CREATE TRIGGER confirmation_request_no_replace
BEFORE INSERT ON confirmation_request
WHEN EXISTS (SELECT 1 FROM confirmation_request WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'confirmation_request is append-only: REPLACE forbidden');
END;

-- ════════════════════════════════════════════════ confirmation_verdict
--
-- This is the one on the list where a silent overwrite would be worst. The row
-- says a HUMAN authorised an effect that leaves Propositum, and it is the only
-- durable trace of that fact. `INSERT OR REPLACE` walking through an UPDATE
-- guard alone would let a `rejected` become a `confirmed` with no record of
-- either — which is why the REPLACE guard is not optional here any more than
-- elsewhere. *(That sentence used to say "the third trigger", 2026-09-08: the
-- delete guard went and this argument did not depend on it. A REPLACE was
-- always caught by the INSERT guard, never by the DELETE one.)*

DROP TRIGGER IF EXISTS confirmation_verdict_no_update;
CREATE TRIGGER confirmation_verdict_no_update
BEFORE UPDATE ON confirmation_verdict
BEGIN
  SELECT RAISE(ABORT, 'confirmation_verdict is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS confirmation_verdict_no_delete;

DROP TRIGGER IF EXISTS confirmation_verdict_no_replace;
CREATE TRIGGER confirmation_verdict_no_replace
BEFORE INSERT ON confirmation_verdict
WHEN EXISTS (SELECT 1 FROM confirmation_verdict WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'confirmation_verdict is append-only: REPLACE forbidden');
END;

-- decision_verdict — the fifth verb, and the one that grants nothing (ADR-0022).
--
-- Guarded on the same edges as every other verdict table ~~— all three —~~ and
-- for a reason that is worth stating because it is NOT the usual one. *(The
-- delete guard went 2026-09-08 with the rest; the UNIQUE below is untouched and
-- is the one doing the work named here.)* The other verdicts are
-- immutable because a rewritten permission is a permission nobody gave. This one
-- grants nothing at all, so the argument has to be different: an answer a person
-- gave to a question their software asked is a record of what they thought at the
-- time, and a record that can be edited afterwards is not one. The UNIQUE on
-- decisionNeededId is what stops a second answer; these three stop the first one
-- being changed into it.

DROP TRIGGER IF EXISTS decision_verdict_no_update;
CREATE TRIGGER decision_verdict_no_update
BEFORE UPDATE ON decision_verdict
BEGIN
  SELECT RAISE(ABORT, 'decision_verdict is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS decision_verdict_no_delete;

DROP TRIGGER IF EXISTS decision_verdict_no_replace;
CREATE TRIGGER decision_verdict_no_replace
BEFORE INSERT ON decision_verdict
WHEN EXISTS (SELECT 1 FROM decision_verdict WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'decision_verdict is append-only: REPLACE forbidden');
END;

-- ═══════════════════════════════════════════════════════ action_evidence
--
-- IMMUTABLE, BUT NOT UNDELETABLE. ~~The one table in this file with two guards
-- instead of three, and the missing one is deliberate.~~ **Corrected 2026-09-08:
-- immutable-but-not-undeletable is now true of every table here (ADR-0038), so
-- this one is no longer distinguished by its shape. It is still distinguished by
-- the REASON, which is the whole of what follows: it is the only table swept on
-- a timer, with no person involved.
--
-- Guarded against UPDATE and REPLACE because a ConfirmationRequest points at one
-- of these rows as the thing the person looked at before authorising an effect:
-- a mutable snapshot means the record of what they were shown is not a record of
-- what they were shown.
--
-- NOT guarded against DELETE, because ActionEvidence is SWEPT. ADR-0010's
-- retention section is explicit — "a no-DELETE trigger and a sweep cannot both
-- be true" — and CONTEXT.md's ActionEvidence entry says the same. This file
-- shipped with all three guards, which made the published retention promise
-- unenforceable at the storage layer while reading, in a green test suite, as
-- though it were enforced. Two documents and one schema disagreed and both
-- documents were right about the half they described:
--
--   * wave 1 was right that the row a person was SHOWN must not change;
--   * ADR-0010 was right that a retention promise needs a DELETE.
--
-- Those are compatible. Immutability is about rewriting history; retention is
-- about how long history is kept. Only the second one needs DELETE, so only the
-- DELETE guard goes.
--
-- What stands in for it: `src/server/evidence-sweep.ts` is the only production
-- code that deletes from this table, and `tests/reachability.test.ts` asserts it
-- runs. If a second deleter ever appears, that is the thing to argue about — not
-- this trigger.

DROP TRIGGER IF EXISTS action_evidence_no_update;
CREATE TRIGGER action_evidence_no_update
BEFORE UPDATE ON action_evidence
BEGIN
  SELECT RAISE(ABORT, 'action_evidence is immutable: UPDATE forbidden');
END;

-- Removed rather than merely absent, because a database created before this
-- change still has the old trigger and `CREATE TRIGGER IF NOT EXISTS` semantics
-- would leave it in place. Every startup runs this file, so every startup drops
-- it — and a sweep that silently fails on some machines and not others is worse
-- than one that never ran anywhere.
DROP TRIGGER IF EXISTS action_evidence_no_delete;

DROP TRIGGER IF EXISTS action_evidence_no_replace;
CREATE TRIGGER action_evidence_no_replace
BEFORE INSERT ON action_evidence
WHEN EXISTS (SELECT 1 FROM action_evidence WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'action_evidence is append-only: REPLACE forbidden');
END;
