CREATE TABLE "ResultSyncAttempt" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "runId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "sourceStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultSyncAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResultSyncAttempt_matchId_createdAt_idx" ON "ResultSyncAttempt"("matchId", "createdAt");
CREATE INDEX "ResultSyncAttempt_provider_idx" ON "ResultSyncAttempt"("provider");
CREATE INDEX "ResultSyncAttempt_status_idx" ON "ResultSyncAttempt"("status");
CREATE INDEX "ResultSyncAttempt_createdAt_idx" ON "ResultSyncAttempt"("createdAt");

ALTER TABLE "ResultSyncAttempt"
ADD CONSTRAINT "ResultSyncAttempt_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResultSyncAttempt"
ADD CONSTRAINT "ResultSyncAttempt_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "ResultSyncRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
