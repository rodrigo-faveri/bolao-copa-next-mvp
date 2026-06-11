CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PoolMember" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PoolMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pool_inviteCode_key" ON "Pool"("inviteCode");
CREATE INDEX "Pool_createdById_idx" ON "Pool"("createdById");
CREATE INDEX "Pool_createdAt_idx" ON "Pool"("createdAt");
CREATE UNIQUE INDEX "PoolMember_poolId_userId_key" ON "PoolMember"("poolId", "userId");
CREATE INDEX "PoolMember_userId_idx" ON "PoolMember"("userId");
CREATE INDEX "PoolMember_poolId_idx" ON "PoolMember"("poolId");

ALTER TABLE "Pool" ADD CONSTRAINT "Pool_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
