import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export const nekoCommand = new SlashCommandBuilder()
  .setName("neko")
  .setDescription("Send a message to AnuNeko")
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("Message to send")
      .setMaxLength(500)
      .setRequired(true),
  );

export const nekoNewCommand = new SlashCommandBuilder()
  .setName("neko-new")
  .setDescription("Start a fresh AnuNeko conversation");

export const nekoModelCommand = new SlashCommandBuilder()
  .setName("neko-model")
  .setDescription("Switch the AnuNeko model for your conversation")
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
    body: [nekoCommand.toJSON(), nekoNewCommand.toJSON(), nekoModelCommand.toJSON()],
  });

  logger.info("Registered Discord slash commands");
}
