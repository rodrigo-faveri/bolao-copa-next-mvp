import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const checkedEnvNames = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_URL",
  "ALLOW_UNSCHEDULED_PREDICTIONS",
  "ENFORCE_HTTPS",
  "RATE_LIMIT_DRIVER",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ALLOWED_EMAILS",
  "ALLOWED_EMAIL_DOMAINS",
  "ADMIN_EMAILS",
  "OPENROUTER_API_KEY",
  "API_FOOTBALL_KEY",
  "MONITORING_WEBHOOK_URL",
  "OBSERVABILITY_PROVIDER",
  "OBSERVABILITY_ENDPOINT_URL",
  "OBSERVABILITY_API_KEY",
  "OBSERVABILITY_SERVICE_NAME",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "JOB_RUNNING_STALE_MINUTES",
  "JOB_RESULT_SYNC_STALE_MINUTES",
  "JOB_PUSH_REMINDER_STALE_MINUTES",
  "JOB_RESULT_PUSH_STALE_MINUTES",
];

function getEnvFileArg() {
  const prefix = "--check-env-file=";
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  return process.env.PRODUCTION_CHECK_ENV_FILE || ".env";
}

function loadDotEnv(fileName = ".env") {
  const envPath = resolve(process.cwd(), fileName);
  if (!existsSync(envPath)) {
    warnings.push(`Env file ${fileName} was not found. Falling back to current process environment.`);
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isEmailAllowedByConfig(email: string, allowedEmails: string[], allowedDomains: string[]) {
  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;
  if (allowedEmails.includes(email)) return true;

  const emailDomain = email.split("@")[1];
  return Boolean(emailDomain && allowedDomains.map((domain) => domain.replace(/^@/, "")).includes(emailDomain));
}

function parseDatabaseUrl(value?: string) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasPlaceholder(value: string | undefined, placeholders: string[]) {
  const normalized = (value ?? "").toLowerCase();
  return placeholders.some((placeholder) => normalized.includes(placeholder));
}

const errors: string[] = [];
const warnings: string[] = [];

const envFile = getEnvFileArg();
if (existsSync(resolve(process.cwd(), envFile))) {
  for (const name of checkedEnvNames) {
    delete process.env[name];
  }
}

loadDotEnv(envFile);

function requireEnv(name: string) {
  if (!process.env[name]) errors.push(`${name} is required.`);
}

requireEnv("DATABASE_URL");
requireEnv("AUTH_SECRET");
requireEnv("AUTH_GOOGLE_ID");
requireEnv("AUTH_GOOGLE_SECRET");
requireEnv("AUTH_URL");

const placeholderChecks: Array<[string, string[]]> = [
  ["DATABASE_URL", ["user:", "senha_local", "senha_forte", "@host", "/database"]],
  ["AUTH_SECRET", ["gere-com", "gere-uma", "npx-auth-secret"]],
  ["AUTH_GOOGLE_ID", ["seu-google", "google-client-id"]],
  ["AUTH_GOOGLE_SECRET", ["seu-google", "google-client-secret"]],
  ["AUTH_URL", ["seudominio.com"]],
  ["UPSTASH_REDIS_REST_URL", ["seu-redis"]],
  ["UPSTASH_REDIS_REST_TOKEN", ["seu-token"]],
  ["VAPID_SUBJECT", ["voce@email.com"]],
];

for (const [name, placeholders] of placeholderChecks) {
  if (hasPlaceholder(process.env[name], placeholders)) {
    errors.push(`${name} still contains a placeholder value.`);
  }
}

const authUrl = process.env.AUTH_URL;
if (authUrl && !authUrl.startsWith("https://")) {
  errors.push("AUTH_URL must use https:// in production.");
}

if (authUrl) {
  const parsedAuthUrl = parseDatabaseUrl(authUrl);
  if (!parsedAuthUrl) {
    errors.push("AUTH_URL must be a valid URL.");
  } else if (["localhost", "127.0.0.1"].includes(parsedAuthUrl.hostname)) {
    warnings.push("AUTH_URL points to localhost. That is usually wrong for production.");
  }
}

if ((process.env.AUTH_SECRET ?? "").length < 32) {
  errors.push("AUTH_SECRET must be at least 32 characters.");
}

if (process.env.ENFORCE_HTTPS === "false") {
  errors.push("ENFORCE_HTTPS must not be false in production.");
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

  if (!["postgresql:", "postgres:"].includes(databaseUrl.protocol)) {
    errors.push("DATABASE_URL must use the postgresql:// protocol.");
  }

  if (["localhost", "127.0.0.1"].includes(databaseUrl.hostname)) {
    warnings.push("DATABASE_URL points to localhost. That is usually wrong for production.");
  }

  if (weakPasswords.has(password.toLowerCase()) || password.length < 16) {
    errors.push("DATABASE_URL password looks weak. Use a unique password with at least 16 characters.");
  }
}

const adminEmails = splitEnvList(process.env.ADMIN_EMAILS);
const allowedEmails = splitEnvList(process.env.ALLOWED_EMAILS);
const allowedDomains = splitEnvList(process.env.ALLOWED_EMAIL_DOMAINS);

for (const email of [...adminEmails, ...allowedEmails]) {
  if (!isEmail(email)) errors.push(`Invalid email configured: ${email}`);
}

if (adminEmails.length === 0) {
  errors.push("ADMIN_EMAILS must contain at least one admin email.");
}

for (const adminEmail of adminEmails) {
  if (!isEmailAllowedByConfig(adminEmail, allowedEmails, allowedDomains)) {
    errors.push(`ADMIN_EMAILS contains ${adminEmail}, but this email is not allowed by ALLOWED_EMAILS/ALLOWED_EMAIL_DOMAINS.`);
  }
}

if (allowedEmails.length === 0 && allowedDomains.length === 0) {
  warnings.push("ALLOWED_EMAILS and ALLOWED_EMAIL_DOMAINS are empty, so any verified Google account can sign in.");
}

if (!["memory", "redis", undefined].includes(process.env.RATE_LIMIT_DRIVER)) {
  errors.push("RATE_LIMIT_DRIVER must be either memory or redis.");
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

if (!process.env.API_FOOTBALL_KEY) {
  warnings.push("API_FOOTBALL_KEY is empty. Real-time match pages will use local fallback.");
}

const vapidValues = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT];
const configuredVapidValues = vapidValues.filter(Boolean).length;
if (configuredVapidValues > 0 && configuredVapidValues < vapidValues.length) {
  errors.push("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured together.");
}
if (configuredVapidValues === 0) {
  warnings.push("VAPID keys are empty. Push notifications outside the browser will be disabled.");
}

const observabilityProvider = (process.env.OBSERVABILITY_PROVIDER || (process.env.MONITORING_WEBHOOK_URL ? "webhook" : "")).toLowerCase();
if (observabilityProvider && !["off", "webhook", "logtail", "datadog", "sentry"].includes(observabilityProvider)) {
  errors.push("OBSERVABILITY_PROVIDER must be off, webhook, logtail, datadog or sentry.");
}

const observabilityUrl = process.env.OBSERVABILITY_ENDPOINT_URL || process.env.MONITORING_WEBHOOK_URL;
if (observabilityUrl) {
  try {
    const monitoringUrl = new URL(observabilityUrl);
    if (!["https:", "http:"].includes(monitoringUrl.protocol)) {
      errors.push("OBSERVABILITY_ENDPOINT_URL/MONITORING_WEBHOOK_URL must use http:// or https://.");
    }
  } catch {
    errors.push("OBSERVABILITY_ENDPOINT_URL/MONITORING_WEBHOOK_URL must be a valid URL.");
  }
} else {
  warnings.push("No observability endpoint configured. External error monitoring is disabled.");
}

if (["logtail", "datadog"].includes(observabilityProvider) && !process.env.OBSERVABILITY_API_KEY) {
  warnings.push("OBSERVABILITY_API_KEY is empty. Logtail/Datadog ingestion may reject logs.");
}

for (const name of ["JOB_RUNNING_STALE_MINUTES", "JOB_RESULT_SYNC_STALE_MINUTES", "JOB_PUSH_REMINDER_STALE_MINUTES", "JOB_RESULT_PUSH_STALE_MINUTES"]) {
  const value = process.env[name];
  if (!value) continue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive integer when configured.`);
  }
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
