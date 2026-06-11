ALTER TABLE "Match" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'scheduled';

CREATE INDEX "Match_status_idx" ON "Match"("status");
