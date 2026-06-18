import { AnuNekoService } from "./anuneko/anuneko.service.js";
import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/discord.client.js";
import { registerDiscordCommands } from "./discord/discord.commands.js";
import { registerDiscordEvents } from "./discord/discord.events.js";
import { SessionStore } from "./sessions/session.store.js";
import { CooldownStore } from "./utils/cooldown.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
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
