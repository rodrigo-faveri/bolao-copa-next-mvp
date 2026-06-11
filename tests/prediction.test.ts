import { equal } from "node:assert/strict";
import { calculatePredictionPoints, isPredictionOpen } from "../lib/prediction";

equal(calculatePredictionPoints(2, 1, 2, 1), 5);
equal(calculatePredictionPoints(2, 0, 1, 0), 3);
equal(calculatePredictionPoints(1, 1, 2, 2), 3);
equal(calculatePredictionPoints(1, 0, 0, 1), 0);

const now = new Date("2026-06-04T12:00:00Z");
equal(isPredictionOpen(new Date("2026-06-04T12:11:00Z"), now), true);
equal(isPredictionOpen(new Date("2026-06-04T12:10:00Z"), now), false);
equal(isPredictionOpen(new Date("2026-06-04T11:00:00Z"), now), false);
equal(isPredictionOpen(null, now), false);
equal(isPredictionOpen(null, now, true), true);

console.info("prediction tests passed");
