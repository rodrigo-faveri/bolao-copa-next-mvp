type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const store = globalThis as typeof globalThis & {
  __bolaoRateLimit?: Map<string, RateLimitBucket>;
};

const buckets = store.__bolaoRateLimit ?? new Map<string, RateLimitBucket>();
store.__bolaoRateLimit = buckets;

export function assertRateLimit(key: string, limit: number, windowMs: number) {
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
