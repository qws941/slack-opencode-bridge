import type { LogLevel } from "./types.js";

const REQUIRED_ENV_VARS = [
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
] as const;

function getRequiredEnv(name: (typeof REQUIRED_ENV_VARS)[number]): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getNumberEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value for ${name}: ${rawValue}`);
  }

  return parsed;
}

function getLogLevel(): LogLevel {
  const rawValue = process.env.LOG_LEVEL ?? "info";
  if (
    rawValue === "debug" ||
    rawValue === "info" ||
    rawValue === "warn" ||
    rawValue === "error"
  ) {
    return rawValue;
  }
  throw new Error(`Invalid LOG_LEVEL value: ${rawValue}`);
}

const slackAppToken = getRequiredEnv("SLACK_APP_TOKEN");
if (!slackAppToken.startsWith("xapp-")) {
  throw new Error("SLACK_APP_TOKEN must start with xapp-");
}

const dbPath = process.env.DB_PATH ?? "./data/sessions.db";

export const config = {
  SLACK_BOT_TOKEN: getRequiredEnv("SLACK_BOT_TOKEN"),
  SLACK_APP_TOKEN: slackAppToken,
  SLACK_SIGNING_SECRET: getRequiredEnv("SLACK_SIGNING_SECRET"),
  OPENCODE_BASE_URL: process.env.OPENCODE_BASE_URL ?? "http://localhost:4096",
  NOTIFICATION_CHANNEL: process.env.NOTIFICATION_CHANNEL ?? "",
  ALERT_DM_USER_ID: process.env.ALERT_DM_USER_ID ?? null,
  GLITCHTIP_WEBHOOK_SECRET: process.env.GLITCHTIP_WEBHOOK_SECRET ?? null,
  DB_PATH: dbPath,
  SESSION_TIMEOUT_SECONDS: getNumberEnv("SESSION_TIMEOUT_SECONDS", 3600),
  CLEANUP_INTERVAL_MS: getNumberEnv("CLEANUP_INTERVAL_MS", 900000),
  STREAM_DEBOUNCE_MS: getNumberEnv("STREAM_DEBOUNCE_MS", 1500),
  PERMISSION_TIMEOUT_MS: getNumberEnv("PERMISSION_TIMEOUT_MS", 300000),
  HEALTH_PORT: getNumberEnv("HEALTH_PORT", 3000),
  LOG_LEVEL: getLogLevel(),
} as const;

export type Config = typeof config;
