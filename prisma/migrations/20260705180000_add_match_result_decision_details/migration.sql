ALTER TABLE "Match" ADD COLUMN "resultMethod" TEXT;
ALTER TABLE "Match" ADD COLUMN "penaltyGoalsA" INTEGER;
ALTER TABLE "Match" ADD COLUMN "penaltyGoalsB" INTEGER;

CREATE INDEX "Match_resultMethod_idx" ON "Match"("resultMethod");
