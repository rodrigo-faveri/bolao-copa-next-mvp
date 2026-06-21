CREATE TABLE "UserMatchAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'pick_deadline',
  "leadMinutes" INTEGER NOT NULL,
  "note" TEXT,
  "source" TEXT NOT NULL DEFAULT 'assistant',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserMatchAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMatchAlert_userId_matchId_kind_key" ON "UserMatchAlert"("userId", "matchId", "kind");
CREATE INDEX "UserMatchAlert_matchId_idx" ON "UserMatchAlert"("matchId");
CREATE INDEX "UserMatchAlert_userId_idx" ON "UserMatchAlert"("userId");
CREATE INDEX "UserMatchAlert_enabled_idx" ON "UserMatchAlert"("enabled");

ALTER TABLE "UserMatchAlert" ADD CONSTRAINT "UserMatchAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMatchAlert" ADD CONSTRAINT "UserMatchAlert_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
