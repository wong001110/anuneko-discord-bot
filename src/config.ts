import "dotenv/config";

export interface AppConfig {
  discordBotToken: string;
  discordClientId: string;
  anuneko: AnuNekoConfig;
  allowedChannelIds: Set<string>;
  enableMentionReplies: boolean;
  maxMessageLength: number;
  anunekoTimeoutMs: number;
  debounceMs: number;
}

export type AnuNekoConfig =
  | DirectAnuNekoConfig
  | AutoAnuNekoConfig
  | SessionAnuNekoConfig
  | BrowserAnuNekoConfig;

export interface DirectAnuNekoConfig {
  mode: "direct";
  token: string;
  baseUrl: string;
}

export interface AutoAnuNekoConfig {
  mode: "auto";
  loginUrl: string;
  createChatUrl: string;
  loginId: string;
  password: string;
  loginIdField: string;
  passwordField: string;
  messageUrlTemplate?: string;
  createChatBody?: Record<string, unknown>;
}

export interface SessionAnuNekoConfig {
  mode: "session";
  sessionToken: string;
  baseUrl: string;
  createChatBody?: Record<string, unknown>;
}

export interface BrowserAnuNekoConfig {
  mode: "browser";
  baseUrl: string;
  browserProfileDir: string;
  browserHeadless: boolean;
  createChatBody?: Record<string, unknown>;
  loginUrl?: string;
  loginId?: string;
  password?: string;
  loginIdField?: string;
  passwordField?: string;
}

const DEFAULT_MAX_MESSAGE_LENGTH = 500;
const DEFAULT_ANUNEKO_TIMEOUT_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 2_000;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function getOptionalBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getOptionalJsonObjectEnv(name: string): Record<string, unknown> | undefined {
  const value = getOptionalEnv(name);

  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function getAllowedChannelIds(): Set<string> {
  const rawValue = process.env.BOT_ALLOWED_CHANNEL_IDS?.trim();

  if (!rawValue) {
    return new Set();
  }

  return new Set(
    rawValue
      .split(",")
      .map((channelId) => channelId.trim())
      .filter(Boolean),
  );
}

function getAnuNekoConfig(): AnuNekoConfig {
  const mode = getOptionalEnv("ANUNEKO_MODE") ?? "direct";

  if (mode === "direct") {
    return {
      mode,
      token: getRequiredEnv("ANUNEKO_TOKEN"),
      baseUrl: getRequiredEnv("ANUNEKO_BASE_URL"),
    };
  }

  if (mode === "auto") {
    return {
      mode,
      loginUrl: getRequiredEnv("ANUNEKO_LOGIN_URL"),
      createChatUrl: getRequiredEnv("ANUNEKO_CREATE_CHAT_URL"),
      loginId: getRequiredEnv("ANUNEKO_LOGIN_ID"),
      password: getRequiredEnv("ANUNEKO_PASSWORD"),
      loginIdField: getOptionalEnv("ANUNEKO_LOGIN_ID_FIELD") ?? "email",
      passwordField: getOptionalEnv("ANUNEKO_PASSWORD_FIELD") ?? "password",
      messageUrlTemplate: getOptionalEnv("ANUNEKO_MESSAGE_URL_TEMPLATE"),
      createChatBody: getOptionalJsonObjectEnv("ANUNEKO_CREATE_CHAT_BODY"),
    };
  }

  if (mode === "session") {
    return {
      mode,
      sessionToken: getRequiredEnv("ANUNEKO_SESSION_TOKEN"),
      baseUrl: getOptionalEnv("ANUNEKO_BASE_URL") ?? "https://anuneko.com",
      createChatBody: getOptionalJsonObjectEnv("ANUNEKO_CREATE_CHAT_BODY"),
    };
  }

  if (mode === "browser") {
    return {
      mode,
      baseUrl: getOptionalEnv("ANUNEKO_BASE_URL") ?? "https://anuneko.com",
      browserProfileDir:
        getOptionalEnv("ANUNEKO_BROWSER_PROFILE_DIR") ?? ".anuneko-test-profile",
      browserHeadless: getOptionalBooleanEnv("ANUNEKO_BROWSER_HEADLESS", false),
      createChatBody: getOptionalJsonObjectEnv("ANUNEKO_CREATE_CHAT_BODY"),
      loginUrl: getOptionalEnv("ANUNEKO_LOGIN_URL"),
      loginId: getOptionalEnv("ANUNEKO_LOGIN_ID"),
      password: getOptionalEnv("ANUNEKO_PASSWORD"),
      loginIdField: getOptionalEnv("ANUNEKO_LOGIN_ID_FIELD") ?? "email",
      passwordField: getOptionalEnv("ANUNEKO_PASSWORD_FIELD") ?? "password",
    };
  }

  throw new Error("ANUNEKO_MODE must be direct, auto, session, or browser");
}

export function loadConfig(): AppConfig {
  return {
    discordBotToken: getRequiredEnv("DISCORD_BOT_TOKEN"),
    discordClientId: getRequiredEnv("DISCORD_CLIENT_ID"),
    anuneko: getAnuNekoConfig(),
    allowedChannelIds: getAllowedChannelIds(),
    enableMentionReplies: getOptionalBooleanEnv(
      "BOT_ENABLE_MENTION_REPLIES",
      false,
    ),
    debounceMs: getOptionalNumberEnv("BOT_DEBOUNCE_MS", DEFAULT_DEBOUNCE_MS),
    maxMessageLength: getOptionalNumberEnv(
      "BOT_MAX_MESSAGE_LENGTH",
      DEFAULT_MAX_MESSAGE_LENGTH,
    ),
    anunekoTimeoutMs: getOptionalNumberEnv(
      "ANUNEKO_TIMEOUT_MS",
      DEFAULT_ANUNEKO_TIMEOUT_MS,
    ),
  };
}
