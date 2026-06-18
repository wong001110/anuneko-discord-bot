import { AnuNekoService } from "./anuneko/anuneko.service.js";
import { AppConfig, loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/discord.client.js";
import { registerDiscordCommands } from "./discord/discord.commands.js";
import { registerDiscordEvents } from "./discord/discord.events.js";
import { SessionStore } from "./sessions/session.store.js";
import { CooldownStore } from "./utils/cooldown.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info("Loaded bot config", getStartupConfigLog(config));

  const client = createDiscordClient({
    enableMentionReplies: config.enableMentionReplies,
  });
  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}; shutting down bot`);
    client.destroy();
    process.exitCode = 0;
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const anunekoService = new AnuNekoService({
    config: config.anuneko,
    timeoutMs: config.anunekoTimeoutMs,
  });

  registerDiscordEvents({
    client,
    config,
    anunekoService,
    sessions: new SessionStore(),
    cooldowns: new CooldownStore(config.cooldownMs),
  });

  await registerDiscordCommands(config);
  await client.login(config.discordBotToken);
}

main().catch((error) => {
  logger.error("Failed to start bot", error);
  process.exitCode = 1;
});

function getStartupConfigLog(config: AppConfig): Record<string, unknown> {
  const baseConfig = {
    discordClientId: config.discordClientId,
    discordBotTokenConfigured: Boolean(config.discordBotToken),
    allowedChannelCount: config.allowedChannelIds.size,
    enableMentionReplies: config.enableMentionReplies,
    cooldownMs: config.cooldownMs,
    debounceMs: config.debounceMs,
    maxMessageLength: config.maxMessageLength,
    anunekoTimeoutMs: config.anunekoTimeoutMs,
  };

  switch (config.anuneko.mode) {
    case "direct":
      return {
        ...baseConfig,
        anuneko: {
          mode: config.anuneko.mode,
          baseUrl: config.anuneko.baseUrl,
          tokenConfigured: Boolean(config.anuneko.token),
        },
      };
    case "auto":
      return {
        ...baseConfig,
        anuneko: {
          mode: config.anuneko.mode,
          loginUrl: config.anuneko.loginUrl,
          createChatUrl: config.anuneko.createChatUrl,
          loginIdConfigured: Boolean(config.anuneko.loginId),
          passwordConfigured: Boolean(config.anuneko.password),
          loginIdField: config.anuneko.loginIdField,
          passwordField: config.anuneko.passwordField,
          messageUrlTemplateConfigured: Boolean(config.anuneko.messageUrlTemplate),
          createChatBodyConfigured: Boolean(config.anuneko.createChatBody),
        },
      };
    case "session":
      return {
        ...baseConfig,
        anuneko: {
          mode: config.anuneko.mode,
          baseUrl: config.anuneko.baseUrl,
          sessionTokenConfigured: Boolean(config.anuneko.sessionToken),
          createChatBodyConfigured: Boolean(config.anuneko.createChatBody),
        },
      };
    case "browser":
      return {
        ...baseConfig,
        anuneko: {
          mode: config.anuneko.mode,
          baseUrl: config.anuneko.baseUrl,
          browserProfileDir: config.anuneko.browserProfileDir,
          browserHeadless: config.anuneko.browserHeadless,
          createChatBodyConfigured: Boolean(config.anuneko.createChatBody),
          loginUrlConfigured: Boolean(config.anuneko.loginUrl),
          loginIdConfigured: Boolean(config.anuneko.loginId),
          passwordConfigured: Boolean(config.anuneko.password),
          loginIdField: config.anuneko.loginIdField,
          passwordField: config.anuneko.passwordField,
        },
      };
  }
}
