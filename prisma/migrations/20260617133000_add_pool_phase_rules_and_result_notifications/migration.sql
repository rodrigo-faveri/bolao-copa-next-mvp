ALTER TABLE "User" ADD COLUMN "notifyResults" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyRoundSummary" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Pool" ADD COLUMN "groupStageExactScorePoints" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Pool" ADD COLUMN "groupStageOutcomePoints" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Pool" ADD COLUMN "knockoutExactScorePoints" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Pool" ADD COLUMN "knockoutOutcomePoints" INTEGER NOT NULL DEFAULT 4;

UPDATE "Pool"
SET
  "groupStageExactScorePoints" = "exactScorePoints",
  "groupStageOutcomePoints" = "outcomePoints";
