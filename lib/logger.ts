type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function sendToMonitoring(payload: Record<string, unknown>) {
  const url = process.env.MONITORING_WEBHOOK_URL;
  if (!url) return;

  fetch(url, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
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
