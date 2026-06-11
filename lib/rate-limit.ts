type RateLimitBucket = {
  count: number;
  resetAt: number;
};

let warnedAboutMemoryRateLimit = false;

const store = globalThis as typeof globalThis & {
  __bolaoRateLimit?: Map<string, RateLimitBucket>;
};

const buckets = store.__bolaoRateLimit ?? new Map<string, RateLimitBucket>();
store.__bolaoRateLimit = buckets;

export function assertRateLimit(key: string, limit: number, windowMs: number) {
  if (process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_DRIVER !== "redis" && !warnedAboutMemoryRateLimit) {
    warnedAboutMemoryRateLimit = true;
    console.warn(JSON.stringify({
      level: "warn",
      event: "rate_limit_memory_driver_in_production",
      timestamp: new Date().toISOString(),
      message: "In-memory rate limit does not protect multiple production instances. Use RATE_LIMIT_DRIVER=redis with a shared store before scaling.",
    }));
  }

  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new Error("Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.");
  }

  current.count += 1;
}
