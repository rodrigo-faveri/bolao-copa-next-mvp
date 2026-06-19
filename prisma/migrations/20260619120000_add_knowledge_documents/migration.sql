CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "url" TEXT,
  "metadata" JSONB,
  "embedding" JSONB,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeDocument_source_sourceId_key" ON "KnowledgeDocument"("source", "sourceId");
CREATE INDEX "KnowledgeDocument_source_idx" ON "KnowledgeDocument"("source");
CREATE INDEX "KnowledgeDocument_updatedAt_idx" ON "KnowledgeDocument"("updatedAt");
