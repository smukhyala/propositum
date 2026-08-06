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
-- ── Why THREE triggers per table, not two ────────────────────────────────
--
-- A no-UPDATE + no-DELETE pair looks sufficient and is not. `INSERT OR REPLACE`
-- deletes the conflicting row and inserts a new one, but `PRAGMA
-- recursive_triggers` defaults OFF, so the DELETE trigger never fires and the
-- row is silently overwritten. Verified. The third trigger — a BEFORE INSERT
-- guard rejecting the REPLACE conflict resolution — is not optional.
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

-- ═══════════════════════════════════════════════════ observation_event

DROP TRIGGER IF EXISTS observation_event_no_update;
CREATE TRIGGER observation_event_no_update
BEFORE UPDATE ON observation_event
BEGIN
  SELECT RAISE(ABORT, 'observation_event is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS observation_event_no_delete;
CREATE TRIGGER observation_event_no_delete
BEFORE DELETE ON observation_event
BEGIN
  SELECT RAISE(ABORT, 'observation_event is append-only: DELETE forbidden');
END;

-- The one that catches INSERT OR REPLACE.
DROP TRIGGER IF EXISTS observation_event_no_replace;
CREATE TRIGGER observation_event_no_replace
BEFORE INSERT ON observation_event
WHEN EXISTS (SELECT 1 FROM observation_event WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'observation_event is append-only: REPLACE forbidden');
END;

-- ═══════════════════════════════════════════════════════ action_intent

DROP TRIGGER IF EXISTS action_intent_no_update;
CREATE TRIGGER action_intent_no_update
BEFORE UPDATE ON action_intent
BEGIN
  SELECT RAISE(ABORT, 'action_intent is append-only: UPDATE forbidden');
END;

DROP TRIGGER IF EXISTS action_intent_no_delete;
CREATE TRIGGER action_intent_no_delete
BEFORE DELETE ON action_intent
BEGIN
  SELECT RAISE(ABORT, 'action_intent is append-only: DELETE forbidden');
END;

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
CREATE TRIGGER action_outcome_no_delete
BEFORE DELETE ON action_outcome
BEGIN
  SELECT RAISE(ABORT, 'action_outcome is append-only: DELETE forbidden');
END;

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
CREATE TRIGGER model_call_record_no_delete
BEFORE DELETE ON model_call_record
BEGIN
  SELECT RAISE(ABORT, 'model_call_record is append-only: DELETE forbidden');
END;

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
CREATE TRIGGER change_verdict_no_delete
BEFORE DELETE ON change_verdict
BEGIN
  SELECT RAISE(ABORT, 'change_verdict is append-only: DELETE forbidden');
END;

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
CREATE TRIGGER document_version_no_delete
BEFORE DELETE ON document_version
BEGIN
  SELECT RAISE(ABORT, 'document_version is insert-only: DELETE forbidden');
END;

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

DROP TRIGGER IF EXISTS handoff_contract_no_delete_accepted;
CREATE TRIGGER handoff_contract_no_delete_accepted
BEFORE DELETE ON handoff_contract
WHEN OLD.status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'handoff_contract cannot be deleted once accepted');
END;
