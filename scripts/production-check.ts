function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDatabaseUrl(value?: string) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const errors: string[] = [];
const warnings: string[] = [];

function requireEnv(name: string) {
  if (!process.env[name]) errors.push(`${name} is required.`);
}

requireEnv("DATABASE_URL");
requireEnv("AUTH_SECRET");
requireEnv("AUTH_GOOGLE_ID");
requireEnv("AUTH_GOOGLE_SECRET");
requireEnv("AUTH_URL");

const authUrl = process.env.AUTH_URL;
if (authUrl && !authUrl.startsWith("https://")) {
  errors.push("AUTH_URL must use https:// in production.");
}

if ((process.env.AUTH_SECRET ?? "").length < 32) {
  errors.push("AUTH_SECRET must be at least 32 characters.");
}

if (process.env.ALLOW_UNSCHEDULED_PREDICTIONS === "true") {
  errors.push("ALLOW_UNSCHEDULED_PREDICTIONS must not be true in production.");
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (!databaseUrl) {
  errors.push("DATABASE_URL must be a valid PostgreSQL URL.");
} else {
  const password = decodeURIComponent(databaseUrl.password);
  const weakPasswords = new Set(["", "postgres", "password", "senha", "admin", "123456", "12345678"]);

  if (["localhost", "127.0.0.1"].includes(databaseUrl.hostname)) {
    warnings.push("DATABASE_URL points to localhost. That is usually wrong for production.");
  }

  if (weakPasswords.has(password.toLowerCase()) || password.length < 16) {
    errors.push("DATABASE_URL password looks weak. Use a unique password with at least 16 characters.");
  }
}

if (splitEnvList(process.env.ADMIN_EMAILS).length === 0) {
  errors.push("ADMIN_EMAILS must contain at least one admin email.");
}

if (splitEnvList(process.env.ALLOWED_EMAILS).length === 0 && splitEnvList(process.env.ALLOWED_EMAIL_DOMAINS).length === 0) {
  warnings.push("ALLOWED_EMAILS and ALLOWED_EMAIL_DOMAINS are empty, so any verified Google account can sign in.");
}

if (process.env.RATE_LIMIT_DRIVER === "redis") {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    errors.push("RATE_LIMIT_DRIVER=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }
} else {
  warnings.push("RATE_LIMIT_DRIVER is not redis. In-memory rate limit does not protect multiple production instances.");
}

if (!process.env.OPENROUTER_API_KEY) {
  warnings.push("OPENROUTER_API_KEY is empty. AI suggestions will use local fallback.");
}

for (const warning of warnings) {
  console.warn(`WARNING: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exit(1);
}

console.info("Production check passed.");
