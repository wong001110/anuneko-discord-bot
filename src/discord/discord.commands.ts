import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export const nekoLinkCommand = new SlashCommandBuilder()
  .setName("neko-link")
  .setDescription("Link this channel to an existing AnuNeko chat")
  .addStringOption((option) =>
    option
      .setName("chat-id")
      .setDescription("AnuNeko chat ID")
      .setRequired(true),
  );

export const nekoNewCommand = new SlashCommandBuilder()
  .setName("neko-new")
  .setDescription("Create and link a fresh AnuNeko chat to this channel");

export const nekoModelCommand = new SlashCommandBuilder()
  .setName("neko-model")
  .setDescription("Switch the AnuNeko model for this channel's linked chat")
  .addStringOption((option) =>
    option
      .setName("model")
      .setDescription("Model to use")
      .setRequired(true)
      .addChoices(
        { name: "Tuxedo Cat", value: "Tuxedo Cat" },
        { name: "Calico Cat", value: "Calico Cat" },
        { name: "American Shorthair", value: "American Shorthair" },
        { name: "British Shorthair", value: "British Shorthair" },
        { name: "Black Cat", value: "Black Cat" },
      ),
  );

export async function registerDiscordCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordBotToken);

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: [nekoLinkCommand.toJSON(), nekoNewCommand.toJSON(), nekoModelCommand.toJSON()],
  });

  logger.info("Registered Discord slash commands");
}
