ALTER TABLE "Match" ADD COLUMN "externalFixtureId" INTEGER;

CREATE INDEX "Match_externalFixtureId_idx" ON "Match"("externalFixtureId");
