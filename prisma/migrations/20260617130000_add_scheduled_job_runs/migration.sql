CREATE TABLE "ScheduledJobRun" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "details" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledJobRun_jobName_idx" ON "ScheduledJobRun"("jobName");
CREATE INDEX "ScheduledJobRun_status_idx" ON "ScheduledJobRun"("status");
CREATE INDEX "ScheduledJobRun_startedAt_idx" ON "ScheduledJobRun"("startedAt");
