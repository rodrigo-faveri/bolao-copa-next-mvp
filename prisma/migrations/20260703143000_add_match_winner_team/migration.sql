ALTER TABLE "Match" ADD COLUMN "winnerTeam" TEXT;

CREATE INDEX "Match_winnerTeam_idx" ON "Match"("winnerTeam");
