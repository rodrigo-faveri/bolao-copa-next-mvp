export const MAX_GOALS = 30;
export const PREDICTION_CLOSE_MINUTES = 10;

export function isPredictionOpen(
  startsAt: Date | null,
  now = new Date(),
  allowUnscheduled = false,
) {
  if (startsAt === null) return allowUnscheduled;
  const closesAt = startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000;
  return closesAt > now.getTime();
}

export function calculatePredictionPoints(
  predictedA: number,
  predictedB: number,
  resultA: number,
  resultB: number,
) {
  if (predictedA === resultA && predictedB === resultB) return 5;

  const predictedOutcome = Math.sign(predictedA - predictedB);
  const resultOutcome = Math.sign(resultA - resultB);

  if (predictedOutcome === resultOutcome) return 3;
  return 0;
}
