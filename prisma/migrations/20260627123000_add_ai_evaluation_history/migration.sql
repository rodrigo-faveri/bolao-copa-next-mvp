CREATE TABLE "AiEvaluationRun" (
    "id" TEXT NOT NULL,
    "averageScore" DOUBLE PRECISION NOT NULL,
    "totalCases" INTEGER NOT NULL,
    "passedCases" INTEGER NOT NULL,
    "failedCases" INTEGER NOT NULL,
    "gitCommit" TEXT,
    "gitBranch" TEXT,
    "embeddingsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiEvaluationCaseResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "minimumScore" INTEGER NOT NULL,
    "missingTerms" JSONB,
    "missingSources" JSONB,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationCaseResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiEvaluationRun_createdAt_idx" ON "AiEvaluationRun"("createdAt");
CREATE INDEX "AiEvaluationRun_gitCommit_idx" ON "AiEvaluationRun"("gitCommit");
CREATE INDEX "AiEvaluationCaseResult_runId_idx" ON "AiEvaluationCaseResult"("runId");
CREATE INDEX "AiEvaluationCaseResult_caseId_idx" ON "AiEvaluationCaseResult"("caseId");
CREATE INDEX "AiEvaluationCaseResult_passed_idx" ON "AiEvaluationCaseResult"("passed");

ALTER TABLE "AiEvaluationCaseResult" ADD CONSTRAINT "AiEvaluationCaseResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
