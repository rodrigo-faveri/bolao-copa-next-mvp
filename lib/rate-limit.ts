import { createHash } from "node:crypto";

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

function safeRateLimitKey(key: string) {
  return `rate-limit:${createHash("sha256").update(key).digest("hex")}`;
}

async function fetchRedisCommand(command: string, ...args: Array<string | number>) {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !token) {
    throw new Error("Rate limit distribuido sem configuracao Redis. Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.");
  }

  const path = [command, ...args.map((arg) => encodeURIComponent(String(arg)))].join("/");
  const response = await fetch(`${restUrl}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Falha ao consultar rate limit distribuido.");
  }

  const payload = await response.json() as { result?: unknown };
  return payload.result;
}

async function assertRedisRateLimit(key: string, limit: number, windowMs: number) {
  const redisKey = safeRateLimitKey(key);
  const countResult = await fetchRedisCommand("incr", redisKey);
  const count = typeof countResult === "number" ? countResult : Number(countResult);

  if (!Number.isFinite(count)) {
    throw new Error("Resposta invalida do rate limit distribuido.");
  }

  if (count === 1) {
    await fetchRedisCommand("expire", redisKey, Math.ceil(windowMs / 1000));
  }

  if (count > limit) {
    throw new Error("Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.");
  }
}

function assertMemoryRateLimit(key: string, limit: number, windowMs: number) {
  const memoryKey = safeRateLimitKey(key);
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
  const current = buckets.get(memoryKey);

  if (!current || current.resetAt <= now) {
    buckets.set(memoryKey, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new Error("Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.");
  }

  current.count += 1;
}

export async function assertRateLimit(key: string, limit: number, windowMs: number) {
  if (process.env.RATE_LIMIT_DRIVER === "redis") {
    await assertRedisRateLimit(key, limit, windowMs);
    return;
  }

  assertMemoryRateLimit(key, limit, windowMs);
}
