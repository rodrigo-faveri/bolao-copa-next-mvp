export const allowUnscheduledPredictions =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_UNSCHEDULED_PREDICTIONS === "true";
