import {
  ChatInputCommandInteraction,
  Client,
  Events,
  Message,
  OmitPartialGroupDMChannel,
} from "discord.js";
import { AnuNekoError } from "../anuneko/anuneko.types.js";
import { AnuNekoService } from "../anuneko/anuneko.service.js";
import { AppConfig } from "../config.js";
import { pickRandomNekoModel } from "./discord.commands.js";
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
  message: string;
}

interface BatchedMessage {
  displayName: string;
  content: string;
}

interface ChannelBatch {
  messages: BatchedMessage[];
  timer: ReturnType<typeof setTimeout>;
  channelRef: OmitPartialGroupDMChannel<Message>["channel"];
  guildId: string;
  channelId: string;
}

export function registerDiscordEvents(
  dependencies: DiscordEventDependencies,
): void {
  const { client } = dependencies;
  const channelBatches = new Map<string, ChannelBatch>();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "neko-link") {
      await handleLinkCommand(dependencies, interaction);
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

async function handleLinkCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureCommandChannel(dependencies, interaction))) {
    return;
  }

  const chatId = interaction.options.getString("chat-id", true).trim();

  if (!chatId) {
    await interaction.reply({
      content: "Please include an AnuNeko chat ID.",
      ephemeral: true,
    });
    return;
  }

  dependencies.sessions.linkChat(
    interaction.guildId!,
    interaction.channelId,
    chatId,
  );

  const announcement = `${getInteractionUserLabel(interaction)} linked this channel to chat \`${chatId}\`.`;
  await announceChannelAction(interaction, announcement);

  await interaction.reply({
    content: "Linked this channel to the AnuNeko chat.",
    ephemeral: true,
  });
}

async function handleNewSessionCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureCommandChannel(dependencies, interaction))) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const model = pickRandomNekoModel();
    const chatId = await dependencies.anunekoService.createChat(model);
    dependencies.sessions.linkChat(
      interaction.guildId!,
      interaction.channelId,
      chatId,
    );
    dependencies.sessions.setModel(
      interaction.guildId!,
      interaction.channelId,
      model,
    );

    const announcement = `${getInteractionUserLabel(interaction)} created and linked a new chat (\`${chatId}\`) with **${model}**.`;
    await announceChannelAction(interaction, announcement);

    await interaction.editReply("Created and linked a new AnuNeko chat.");
  } catch (error) {
    logAnuNekoError(error);
    const errorMessage = getErrorMessage(error);
    await announceChannelAction(
      interaction,
      `${getInteractionUserLabel(interaction)} tried to create a new chat, but it failed: ${errorMessage}`,
    );
    await interaction.editReply(errorMessage);
  }
}

async function handleModelCommand(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await ensureCommandChannel(dependencies, interaction))) {
    return;
  }

  const model = interaction.options.getString("model", true);
  await interaction.deferReply({ ephemeral: true });

  try {
    const session = dependencies.sessions.getSession(
      interaction.guildId!,
      interaction.channelId,
    );
    const chatId =
      session.chatId ?? (await dependencies.anunekoService.createChat(model));

    if (session.chatId) {
      await dependencies.anunekoService.updateChatModel(chatId, model);
    }

    dependencies.sessions.linkChat(
      interaction.guildId!,
      interaction.channelId,
      chatId,
    );
    dependencies.sessions.setModel(
      interaction.guildId!,
      interaction.channelId,
      model,
    );

    const announcement = `${getInteractionUserLabel(interaction)} switched this channel's chat to **${model}**.`;
    await announceChannelAction(interaction, announcement);

    await interaction.editReply(`Switched this channel's chat to **${model}**.`);
  } catch (error) {
    logAnuNekoError(error);
    const errorMessage = getErrorMessage(error);
    await announceChannelAction(
      interaction,
      `${getInteractionUserLabel(interaction)} tried to switch the model, but it failed: ${errorMessage}`,
    );
    await interaction.editReply(errorMessage);
  }
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

  const session = dependencies.sessions.getSession(
    message.guildId,
    message.channelId,
  );

  if (!session.chatId) {
    return;
  }

  const content = resolveMentions(
    message.content.trim(),
    message.mentions.users,
  );
  const validationMessage = validateUserMessage(dependencies.config, content);

  if (validationMessage) {
    return;
  }

  const cooldownMessage = getCooldownMessage(
    dependencies.cooldowns,
    message.author.id,
  );

  if (cooldownMessage) {
    return;
  }

  dependencies.cooldowns.markUsed(message.author.id);

  const batchKey = `${message.guildId}:${message.channelId}`;
  const batched: BatchedMessage = {
    displayName: getDisplayName(message),
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
    .map((m) => toAnuNekoMessage(m.displayName, m.content))
    .join("\n\n");

  await batch.channelRef.sendTyping();
  const typingInterval = setInterval(
    () => void batch.channelRef.sendTyping(),
    8_000,
  );

  try {
    const reply = await getAnuNekoReply(dependencies, {
      guildId: batch.guildId,
      channelId: batch.channelId,
      message: combined,
    });

    await batch.channelRef.send(reply);
  } finally {
    clearInterval(typingInterval);
  }
}

async function getAnuNekoReply(
  dependencies: DiscordEventDependencies,
  input: HandleNekoMessageInput,
): Promise<string> {
  const session = dependencies.sessions.getSession(
    input.guildId,
    input.channelId,
  );

  if (!session.chatId) {
    return "This channel is not linked to an AnuNeko chat yet.";
  }

  try {
    const result = await dependencies.anunekoService.sendMessage({
      message: input.message,
      chatId: session.chatId,
    });

    dependencies.sessions.updateSession(input.guildId, input.channelId, {
      chatId: result.chatId ?? session.chatId,
      lastMessageAt: Date.now(),
    });

    return result.text;
  } catch (error) {
    logAnuNekoError(error);
    return getErrorMessage(error);
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
      case "request_failed":
        if (error.message.includes("not supported")) {
          return error.message;
        }

        return "AnuNeko is not responding right now. Please try again later.";
      default:
        return "AnuNeko is not responding right now. Please try again later.";
    }
  }

  return "AnuNeko is not responding right now. Please try again later.";
}

function validateUserMessage(
  config: AppConfig,
  message: string,
): string | undefined {
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
    config.allowedChannelIds.size === 0 ||
    config.allowedChannelIds.has(channelId)
  );
}

async function ensureCommandChannel(
  dependencies: DiscordEventDependencies,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Please use this command inside a server.",
      ephemeral: true,
    });
    return false;
  }

  if (!isAllowedChannel(dependencies.config, interaction.channelId)) {
    await interaction.reply({
      content: "This bot is not enabled in this channel.",
      ephemeral: true,
    });
    return false;
  }

  return true;
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

function toAnuNekoMessage(displayName: string, message: string): string {
  return `[${displayName}]:\n${message}`;
}

function getDisplayName(message: OmitPartialGroupDMChannel<Message>): string {
  return message.member?.displayName ?? message.author.displayName;
}

function getInteractionUserLabel(
  interaction: ChatInputCommandInteraction,
): string {
  const displayName =
    interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.displayName;

  return `**${displayName}**`;
}

async function announceChannelAction(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const channel = interaction.channel;

  if (!channel?.isSendable()) {
    return;
  }

  await channel.send(content);
}

function logAnuNekoError(error: unknown): void {
  if (error instanceof AnuNekoError) {
    logger.error(`AnuNeko ${error.code}: ${error.message}`, error.cause);
    return;
  }

  logger.error("Unexpected AnuNeko error", error);
}
