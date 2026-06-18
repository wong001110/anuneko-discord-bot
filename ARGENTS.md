# ARGENTS.md

## Project Goal

Build a private Discord bot that forwards Discord user messages to an unofficial AnuNeko chat endpoint, receives the AnuNeko response, and replies back in Discord.

This is for private experimentation first, not public mass deployment.

## Core Requirements

### 1. Discord Bot

Use `discord.js` with TypeScript.

The bot should support:

- Reply when mentioned.
- Slash command: `/neko <message>`.
- Optional channel restriction.
- Cooldown per user to prevent spam.
- Clear fallback message when AnuNeko fails.
- Do not expose internal errors to Discord users.

Example behavior:

```text
User: /neko hello
Bot: <reply from AnuNeko>
```

## 2. AnuNeko Adapter

Create a separate service/module for AnuNeko requests.

Do not hardcode tokens.

Use environment variables:

```env
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
ANUNEKO_TOKEN=
ANUNEKO_BASE_URL=
BOT_ALLOWED_CHANNEL_IDS=
```

The adapter should:

- Send user message to AnuNeko.
- Include conversation/session ID if required.
- Return plain text response.
- Handle expired token, rate limit, timeout, and invalid response.
- Keep request logic isolated so it can be changed later.

## 3. Session Handling

For MVP, do not use a database.

Use in-memory `Map`.

Session key format:

```ts
`${guildId}:${channelId}:${userId}`;
```

Store:

```ts
{
  chatId?: string;
  lastMessageAt: number;
}
```

Note: sessions can reset when the bot restarts. That is acceptable for MVP.

## 4. Safety / Abuse Control

Add:

- Per-user cooldown, default 5–10 seconds.
- Max message length, default 500 characters.
- Ignore bot messages.
- Ignore empty messages.
- Do not allow everyone to spam the AnuNeko token.
- Log errors internally, but reply politely to users.

Fallback reply example:

```text
AnuNeko is not responding right now. Please try again later.
```

## 5. Suggested Project Structure

```text
src/
  main.ts
  config.ts
  discord/
    discord.client.ts
    discord.commands.ts
    discord.events.ts
  anuneko/
    anuneko.service.ts
    anuneko.types.ts
  sessions/
    session.store.ts
  utils/
    cooldown.ts
    logger.ts
```

## 6. Implementation Notes

- Prefer TypeScript.
- Prefer clean service separation.
- Avoid over-engineering.
- Do not add database unless needed.
- Do not commit `.env`.
- Add `.env.example`.
- Add meaningful error handling.
- Add README setup instructions.

## 7. MVP Scope

Build only:

1. Discord bot login.
2. `/neko <message>` command.
3. Mention-based reply.
4. AnuNeko request adapter.
5. In-memory session map.
6. Cooldown.
7. Environment config.
8. Basic README.

Do not build:

- Dashboard.
- Multi-server admin panel.
- Database.
- Payment system.
- Public bot listing.
- Auto-spam behavior.
- Fake engagement features.

## 8. Important Constraint

This project uses an unofficial AnuNeko integration. Keep the code modular so the AnuNeko adapter can be replaced with another model/API later.

Do not design the bot for fake engagement, mass messaging, bot farming, or automated manipulation.
