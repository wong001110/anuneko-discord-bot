import { Client, GatewayIntentBits, Partials } from "discord.js";

interface CreateDiscordClientOptions {
  enableMentionReplies: boolean;
}

export function createDiscordClient(options: CreateDiscordClientOptions): Client {
  const intents = [GatewayIntentBits.Guilds];

  if (options.enableMentionReplies) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }

  return new Client({
    intents,
    partials: [Partials.Channel],
  });
}
