type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

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
