CREATE TABLE "ResultSyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ResultSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResultSyncRun_provider_idx" ON "ResultSyncRun"("provider");
CREATE INDEX "ResultSyncRun_status_idx" ON "ResultSyncRun"("status");
CREATE INDEX "ResultSyncRun_startedAt_idx" ON "ResultSyncRun"("startedAt");
