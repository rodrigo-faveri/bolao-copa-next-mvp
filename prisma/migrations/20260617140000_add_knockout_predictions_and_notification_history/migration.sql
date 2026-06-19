ALTER TABLE "PushNotificationLog" ADD COLUMN "title" TEXT;
ALTER TABLE "PushNotificationLog" ADD COLUMN "body" TEXT;
ALTER TABLE "PushNotificationLog" ADD COLUMN "url" TEXT;

CREATE TABLE "KnockoutPrediction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "poolId" TEXT,
  "poolScope" TEXT NOT NULL DEFAULT 'global',
  "bracketRound" TEXT NOT NULL,
  "bracketMatchId" TEXT NOT NULL,
  "homeLabel" TEXT NOT NULL,
  "awayLabel" TEXT NOT NULL,
  "homeTeam" TEXT,
  "awayTeam" TEXT,
  "winnerTeam" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnockoutPrediction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnockoutPrediction_userId_poolScope_bracketMatchId_key" ON "KnockoutPrediction"("userId", "poolScope", "bracketMatchId");
CREATE INDEX "KnockoutPrediction_userId_idx" ON "KnockoutPrediction"("userId");
CREATE INDEX "KnockoutPrediction_poolId_idx" ON "KnockoutPrediction"("poolId");
CREATE INDEX "KnockoutPrediction_poolScope_idx" ON "KnockoutPrediction"("poolScope");
CREATE INDEX "KnockoutPrediction_bracketRound_idx" ON "KnockoutPrediction"("bracketRound");

ALTER TABLE "KnockoutPrediction" ADD CONSTRAINT "KnockoutPrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnockoutPrediction" ADD CONSTRAINT "KnockoutPrediction_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
