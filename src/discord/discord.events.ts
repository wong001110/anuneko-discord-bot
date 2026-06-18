import {
  ChatInputCommandInteraction,
  Client,
  Events,
  Message,
  OmitPartialGroupDMChannel,
} from "discord.js";
import { AnuNekoError, SendMessageResult } from "../anuneko/anuneko.types.js";
import { AnuNekoService } from "../anuneko/anuneko.service.js";
import { AppConfig } from "../config.js";
import { SessionStore } from "../sessions/session.store.js";
import { CooldownStore } from "../utils/cooldown.js";
import { logger } from "../utils/logger.js";

interface DiscordEventDependencies {
  client: Client;
  config: AppConfig;
  anunekoService: AnuNekoService;
  sessions: SessionStore;
  cooldowns: CooldownStore;
}

interface HandleNekoMessageInput {
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
  message: string;
}

interface BatchedMessage {
  userId: string;
  username: string;
  content: string;
}

interface ChannelBatch {
  messages: BatchedMessage[];
  timer: ReturnType<typeof setTimeout>;
  channelRef: OmitPartialGroupDMChannel<Message>["channel"];
  guildId: string;
  channelId: string;
}

export function registerDiscordEvents(dependencies: DiscordEventDependencies): void {
  const { client } = dependencies;
  const channelBatches = new Map<string, ChannelBatch>();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "neko") {
      await handleSlashCommand(dependencies, interaction);
    } else if (interaction.commandName === "neko-new") {
      await handleNewSessionCommand(dependencies, interaction);
    } else if (interaction.commandName === "neko-model") {
      await handleModelCommand(dependencies, interaction);
    }
  });

  if (dependencies.config.enableMentionReplies) {
    client.on(Events.MessageCreate, async (message) => {
      await handleChannelMessage(dependencies, message, channelBatches);
    });
  }
}

async function handleSlashCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Please use this command inside a server.",
      ephemeral: true,
    });
    return;
  }

  if (!isAllowedChannel(dependencies.config, interaction.channelId)) {
    await interaction.reply({
      content: "This bot is not enabled in this channel.",
      ephemeral: true,
    });
    return;
  }

  const message = interaction.options.getString("message", true).trim();
  const validationMessage = validateUserMessage(dependencies.config, message);

  if (validationMessage) {
    await interaction.reply({
      content: validationMessage,
      ephemeral: true,
    });
    return;
  }

  const cooldownMessage = getCooldownMessage(
    dependencies.cooldowns,
    interaction.user.id,
  );

  if (cooldownMessage) {
    await interaction.reply({
      content: cooldownMessage,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const reply = await getAnuNekoReply(dependencies, {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    username: interaction.user.username,
    message: `[${interaction.user.username}]: ${message}`,
  });

  dependencies.cooldowns.markUsed(interaction.user.id);
  await interaction.editReply(reply.text);
}

async function handleNewSessionCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Please use this command inside a server.",
      ephemeral: true,
    });
    return;
  }

  dependencies.sessions.clearSession(interaction.guildId, interaction.channelId, interaction.user.id);

  await interaction.reply({
    content: "Started a new conversation.",
    ephemeral: true,
  });
}

async function handleModelCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Please use this command inside a server.",
      ephemeral: true,
    });
    return;
  }

  const model = interaction.options.getString("model", true);

  dependencies.sessions.setModel(interaction.guildId, interaction.channelId, interaction.user.id, model);

  await interaction.reply({
    content: `Switched to **${model}**. A new conversation will start with your next message.`,
    ephemeral: true,
  });
}

async function handleChannelMessage(
  dependencies: DiscordEventDependencies,
  message: OmitPartialGroupDMChannel<Message>,
  channelBatches: Map<string, ChannelBatch>,
): Promise<void> {
  if (message.author.bot || !message.guildId) {
    return;
  }

  if (!isAllowedChannel(dependencies.config, message.channelId)) {
    return;
  }

  const content = resolveMentions(message.content.trim(), message.mentions.users);
  const validationMessage = validateUserMessage(dependencies.config, content);

  if (validationMessage) {
    return;
  }

  const cooldownMessage = getCooldownMessage(dependencies.cooldowns, message.author.id);

  if (cooldownMessage) {
    return;
  }

  dependencies.cooldowns.markUsed(message.author.id);

  const batchKey = `${message.guildId}:${message.channelId}`;
  const batched: BatchedMessage = {
    userId: message.author.id,
    username: message.author.username,
    content,
  };

  const existing = channelBatches.get(batchKey);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(batched);
    existing.timer = setTimeout(
      () => void flushBatch(batchKey, channelBatches, dependencies),
      dependencies.config.debounceMs,
    );
  } else {
    channelBatches.set(batchKey, {
      messages: [batched],
      timer: setTimeout(
        () => void flushBatch(batchKey, channelBatches, dependencies),
        dependencies.config.debounceMs,
      ),
      channelRef: message.channel,
      guildId: message.guildId,
      channelId: message.channelId,
    });
  }
}

async function flushBatch(
  key: string,
  channelBatches: Map<string, ChannelBatch>,
  dependencies: DiscordEventDependencies,
): Promise<void> {
  const batch = channelBatches.get(key);

  if (!batch) {
    return;
  }

  channelBatches.delete(key);

  const combined = batch.messages
    .map((m) => `[${m.username}]: ${m.content}`)
    .join("\n");

  const firstMsg = batch.messages[0];

  await batch.channelRef.sendTyping();
  const typingInterval = setInterval(
    () => void batch.channelRef.sendTyping(),
    8_000,
  );

  try {
    const reply = await getAnuNekoReply(dependencies, {
      guildId: batch.guildId,
      channelId: batch.channelId,
      userId: firstMsg.userId,
      username: firstMsg.username,
      message: combined,
    });

    await batch.channelRef.send(reply.text);
  } finally {
    clearInterval(typingInterval);
  }
}

async function getAnuNekoReply(
  dependencies: DiscordEventDependencies,
  input: HandleNekoMessageInput,
): Promise<SendMessageResult> {
  const session = dependencies.sessions.getSession(
    input.guildId,
    input.channelId,
    input.userId,
  );

  try {
    const result = await dependencies.anunekoService.sendMessage({
      message: input.message,
      chatId: session.chatId,
      model: session.model,
    });

    dependencies.sessions.updateSession(input.guildId, input.channelId, input.userId, {
      chatId: result.chatId ?? session.chatId,
      lastMessageAt: Date.now(),
    });

    return result;
  } catch (error) {
    logAnuNekoError(error);
    return {
      text: getErrorMessage(error),
      chatId: session.chatId,
    };
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof AnuNekoError) {
    switch (error.code) {
      case "rate_limited":
        return "AnuNeko is rate-limited right now. Please wait a moment.";
      case "timeout":
        return "AnuNeko took too long to respond. Please try again.";
      case "expired_token":
        return "AnuNeko session has expired. The bot will reconnect automatically.";
      default:
        return "AnuNeko is not responding right now. Please try again later.";
    }
  }

  return "AnuNeko is not responding right now. Please try again later.";
}

function validateUserMessage(config: AppConfig, message: string): string | undefined {
  if (!message) {
    return "Please include a message for AnuNeko.";
  }

  if (message.length > config.maxMessageLength) {
    return `Please keep messages under ${config.maxMessageLength} characters.`;
  }

  return undefined;
}

function isAllowedChannel(config: AppConfig, channelId: string): boolean {
  return (
    config.allowedChannelIds.size === 0 || config.allowedChannelIds.has(channelId)
  );
}

function getCooldownMessage(
  cooldowns: CooldownStore,
  userId: string,
): string | undefined {
  const remainingMs = cooldowns.getRemainingMs(userId);

  if (remainingMs === 0) {
    return undefined;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  return `Please wait ${remainingSeconds}s before sending another message.`;
}

function resolveMentions(
  content: string,
  mentionedUsers: ReadonlyMap<string, { username: string }>,
): string {
  return content.replace(/<@!?(\d+)>/g, (match, userId: string) => {
    const user = mentionedUsers.get(userId);
    return user ? `@${user.username}` : match;
  });
}

function logAnuNekoError(error: unknown): void {
  if (error instanceof AnuNekoError) {
    logger.error(`AnuNeko ${error.code}: ${error.message}`, error.cause);
    return;
  }

  logger.error("Unexpected AnuNeko error", error);
}
