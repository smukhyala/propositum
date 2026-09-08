-- CreateTable
CREATE TABLE "intention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "objective" TEXT NOT NULL,
    "definitionOfDone" TEXT NOT NULL,
    "completedAt" DATETIME,
    "statedWait" TEXT,
    "statedWaitAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "intention_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seq" INTEGER NOT NULL,
    "statedBy" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "intentionId" TEXT,
    CONSTRAINT "external_event_intentionId_fkey" FOREIGN KEY ("intentionId") REFERENCES "intention" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "work_session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "intentionId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'observing',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "work_session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "work_session_intentionId_fkey" FOREIGN KEY ("intentionId") REFERENCES "intention" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approved_source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "originPattern" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grantState" TEXT NOT NULL DEFAULT 'granted',
    "grantCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approved_source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "observation_event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sourceSeq" INTEGER,
    "observedAt" DATETIME NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "approvedSourceId" TEXT,
    "documentId" TEXT,
    "attested" JSONB NOT NULL,
    "untrusted" JSONB,
    CONSTRAINT "observation_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "work_session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "observation_event_approvedSourceId_fkey" FOREIGN KEY ("approvedSourceId") REFERENCES "approved_source" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "session_reading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "throughSeq" INTEGER NOT NULL,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "session_reading_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "work_session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "session_claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "readingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'inferred',
    "confidence" TEXT,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "session_claim_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "session_reading" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "quote" TEXT,
    CONSTRAINT "evidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "session_claim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "work_offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "threadSignature" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "outline" JSONB NOT NULL,
    "produces" TEXT NOT NULL,
    "excludes" JSONB NOT NULL,
    "originPatterns" JSONB NOT NULL,
    "expectedKinds" JSONB NOT NULL,
    "grounds" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_offer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "work_session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handoff_contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "intentionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "acceptedAt" DATETIME,
    "objective" TEXT NOT NULL,
    "definitionOfDone" TEXT NOT NULL,
    "guidance" JSONB NOT NULL,
    "approvedSourceIds" JSONB NOT NULL,
    "allowedActionKinds" JSONB NOT NULL,
    "baseVersionId" TEXT,
    "purchaseOriginPattern" TEXT,
    "purchaseWhatFor" TEXT,
    "purchaseMaxAmountMinor" INTEGER,
    "purchaseCurrency" TEXT,
    "purchaseMaxCount" INTEGER,
    "initiative" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "interruption" TEXT NOT NULL,
    "timeLimitMinutes" INTEGER NOT NULL,
    CONSTRAINT "handoff_contract_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "work_session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "handoff_contract_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "session_reading" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "handoff_contract_intentionId_fkey" FOREIGN KEY ("intentionId") REFERENCES "intention" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "handoff_contract_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "document_version" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "terminalReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "leaseUntil" DATETIME,
    "progressStep" INTEGER NOT NULL DEFAULT 0,
    "controlToken" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "claimedBy" TEXT,
    "resumesRunId" TEXT,
    CONSTRAINT "agent_run_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "handoff_contract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_step" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    CONSTRAINT "plan_step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_intent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "authorized" BOOLEAN NOT NULL,
    "refusedRule" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_intent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "action_intent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "plan_step" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intentId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "scopeVerdict" TEXT NOT NULL,
    "detail" TEXT,
    "draftText" TEXT,
    "observedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_outcome_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "action_intent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_call_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "boundary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "stopReason" TEXT,
    "failureKind" TEXT,
    "repairTurns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "model_call_record_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shift_outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reversibility" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "citedActionIntentIds" JSONB NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_outcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outcome_verdict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outcomeId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "editedText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outcome_verdict_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "shift_outcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "confirmation_request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidenceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "confirmation_request_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "confirmation_request_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "action_intent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "confirmation_request_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "action_evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "confirmation_verdict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "confirmation_verdict_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "confirmation_request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "intentId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "untrusted" JSONB,
    "image" BLOB,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_evidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "action_evidence_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "action_intent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_dispatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "reportedAt" DATETIME,
    CONSTRAINT "action_dispatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "action_dispatch_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "action_intent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "committedFromChangesetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_version_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_version_committedFromChangesetId_fkey" FOREIGN KEY ("committedFromChangesetId") REFERENCES "changeset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "changeset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "baseVersionId" TEXT NOT NULL,
    "baseHash" TEXT NOT NULL,
    "outcomeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "changeset_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "handoff_contract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "changeset_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "document_version" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "changeset_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "shift_outcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "proposed_change" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changesetId" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "exact" TEXT NOT NULL,
    "suffix" TEXT NOT NULL,
    "replacement" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "proposed_change_changesetId_fkey" FOREIGN KEY ("changesetId") REFERENCES "changeset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "change_verdict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "editedText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_verdict_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "proposed_change" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "changeId" TEXT,
    "outcomeId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    CONSTRAINT "review_finding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_finding_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "proposed_change" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "review_finding_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "shift_outcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_needed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "whyStopped" TEXT NOT NULL,
    "needs" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    CONSTRAINT "decision_needed_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "shift_report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_verdict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionNeededId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    CONSTRAINT "decision_verdict_decisionNeededId_fkey" FOREIGN KEY ("decisionNeededId") REFERENCES "decision_needed" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shift_report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "narrative" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_report_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "handoff_contract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calendar_connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshRejectedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "thread_connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "pairedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdateId" INTEGER
);

-- CreateTable
CREATE TABLE "thread_message_sent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "thread_message_sent_provider_fkey" FOREIGN KEY ("provider") REFERENCES "thread_connection" ("provider") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "offer_tally" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "observedMinutes" INTEGER NOT NULL DEFAULT 0,
    "offersShown" INTEGER NOT NULL DEFAULT 0,
    "offersDeclined" INTEGER NOT NULL DEFAULT 0,
    "strandsSuppressed" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "install_secret" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "extension_pairing" (
    "browser" TEXT NOT NULL PRIMARY KEY,
    "extensionId" TEXT NOT NULL,
    "pairedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "offer_reticence" (
    "signatureHash" TEXT NOT NULL PRIMARY KEY,
    "declines" INTEGER NOT NULL DEFAULT 0,
    "lastDeclinedOn" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "intention_projectId_key" ON "intention"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "external_event_seq_key" ON "external_event"("seq");

-- CreateIndex
CREATE INDEX "external_event_intentionId_idx" ON "external_event"("intentionId");

-- CreateIndex
CREATE INDEX "work_session_projectId_idx" ON "work_session"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "approved_source_projectId_originPattern_key" ON "approved_source"("projectId", "originPattern");

-- CreateIndex
CREATE INDEX "observation_event_sessionId_kind_idx" ON "observation_event"("sessionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "observation_event_sessionId_seq_key" ON "observation_event"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "session_reading_sessionId_idx" ON "session_reading"("sessionId");

-- CreateIndex
CREATE INDEX "session_claim_readingId_kind_idx" ON "session_claim"("readingId", "kind");

-- CreateIndex
CREATE INDEX "evidence_claimId_idx" ON "evidence"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "work_offer_sessionId_key" ON "work_offer"("sessionId");

-- CreateIndex
CREATE INDEX "handoff_contract_sessionId_idx" ON "handoff_contract"("sessionId");

-- CreateIndex
CREATE INDEX "agent_run_status_createdAt_idx" ON "agent_run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_run_contractId_idx" ON "agent_run"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_step_runId_ordinal_key" ON "plan_step"("runId", "ordinal");

-- CreateIndex
CREATE INDEX "action_intent_runId_authorized_idx" ON "action_intent"("runId", "authorized");

-- CreateIndex
CREATE UNIQUE INDEX "action_intent_runId_seq_key" ON "action_intent"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "action_outcome_intentId_key" ON "action_outcome"("intentId");

-- CreateIndex
CREATE INDEX "model_call_record_runId_idx" ON "model_call_record"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_outcome_runId_ordinal_key" ON "shift_outcome"("runId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_verdict_outcomeId_key" ON "outcome_verdict"("outcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "confirmation_request_intentId_key" ON "confirmation_request"("intentId");

-- CreateIndex
CREATE INDEX "confirmation_request_runId_idx" ON "confirmation_request"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "confirmation_verdict_requestId_key" ON "confirmation_verdict"("requestId");

-- CreateIndex
CREATE INDEX "action_evidence_runId_idx" ON "action_evidence"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "action_dispatch_intentId_key" ON "action_dispatch"("intentId");

-- CreateIndex
CREATE INDEX "action_dispatch_runId_status_idx" ON "action_dispatch"("runId", "status");

-- CreateIndex
CREATE INDEX "document_projectId_idx" ON "document"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_committedFromChangesetId_key" ON "document_version"("committedFromChangesetId");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_documentId_ordinal_key" ON "document_version"("documentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "changeset_outcomeId_key" ON "changeset"("outcomeId");

-- CreateIndex
CREATE INDEX "changeset_contractId_idx" ON "changeset"("contractId");

-- CreateIndex
CREATE INDEX "proposed_change_changesetId_idx" ON "proposed_change"("changesetId");

-- CreateIndex
CREATE UNIQUE INDEX "change_verdict_changeId_key" ON "change_verdict"("changeId");

-- CreateIndex
CREATE INDEX "review_finding_runId_idx" ON "review_finding"("runId");

-- CreateIndex
CREATE INDEX "decision_needed_reportId_idx" ON "decision_needed"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_verdict_decisionNeededId_key" ON "decision_verdict"("decisionNeededId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_report_contractId_key" ON "shift_report"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connection_provider_key" ON "calendar_connection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "thread_connection_provider_key" ON "thread_connection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "thread_message_sent_key_key" ON "thread_message_sent"("key");

-- CreateIndex
CREATE INDEX "thread_message_sent_provider_idx" ON "thread_message_sent"("provider");

