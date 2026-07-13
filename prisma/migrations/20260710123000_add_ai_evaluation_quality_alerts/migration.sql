ALTER TABLE "AiEvaluationRun"
ADD COLUMN "previousAverageScore" DOUBLE PRECISION,
ADD COLUMN "scoreDelta" DOUBLE PRECISION,
ADD COLUMN "qualityAlert" TEXT;
