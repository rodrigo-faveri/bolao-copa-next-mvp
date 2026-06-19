type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function getObservabilityConfig() {
  const provider = (process.env.OBSERVABILITY_PROVIDER || (process.env.MONITORING_WEBHOOK_URL ? "webhook" : "")).toLowerCase();
  const service = process.env.OBSERVABILITY_SERVICE_NAME || "bolao-copa-next-mvp";
  const endpoint = process.env.OBSERVABILITY_ENDPOINT_URL || process.env.MONITORING_WEBHOOK_URL;
  const apiKey = process.env.OBSERVABILITY_API_KEY;

  if (!provider || provider === "off") return null;
  if (!["webhook", "logtail", "datadog", "sentry"].includes(provider)) return null;

  return { apiKey, endpoint, provider, service };
}

function sendToMonitoring(payload: Record<string, unknown>) {
  const config = getObservabilityConfig();
  if (!config) return;

  const url =
    config.endpoint
    || (config.provider === "logtail" ? "https://in.logtail.com/" : "")
    || (config.provider === "datadog" ? "https://http-intake.logs.datadoghq.com/api/v2/logs" : "");

  if (!url) return;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.provider === "logtail" && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.provider === "datadog" && config.apiKey) headers["DD-API-KEY"] = config.apiKey;

  fetch(url, {
    body: JSON.stringify({
      ...payload,
      provider: config.provider,
      service: config.service,
    }),
    headers,
    method: "POST",
  }).catch((error) => {
    console.warn(JSON.stringify({
      level: "warn",
      event: "monitoring_webhook_failed",
      message: error instanceof Error ? error.message : "unknown",
      timestamp: new Date().toISOString(),
    }));
  });
}

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const message = JSON.stringify(payload);
  if (level === "error") {
    console.error(message);
    sendToMonitoring(payload);
    return;
  }
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.info(message);
}

export const logger = {
  info: (event: string, fields?: LogFields) => writeLog("info", event, fields),
  warn: (event: string, fields?: LogFields) => writeLog("warn", event, fields),
  error: (event: string, fields?: LogFields) => writeLog("error", event, fields),
};
