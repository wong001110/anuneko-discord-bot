# Auto Reply Discord Bot

Private Discord bot that links Discord channels to AnuNeko browser-mode chats and replies with AnuNeko responses.

## Features

- `/neko-link` links the current Discord channel to an existing AnuNeko chat ID.
- `/neko-new` creates a fresh AnuNeko chat and links it to the current channel.
- `/neko-model` switches the model for the current channel's linked chat.
- Normal channel messages are sent to AnuNeko only after the channel is linked.
- Channel-to-chat links are stored in memory and reset when the bot restarts.
- Message batching keeps quick consecutive Discord messages together.

Messages sent to AnuNeko use this format:

```text
[Andy#1234]:
你好

[Alice#5678]:
你好
```

For newer Discord accounts without a classic discriminator, the bot uses the Discord user ID as the code.

## Setup

Requires Node.js 18.17 or newer.

```bash
npm install
npm run build
npm start
```

Use browser mode only:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id

ANUNEKO_MODE=browser
ANUNEKO_BASE_URL=https://anuneko.com
ANUNEKO_BROWSER_PROFILE_DIR=.anuneko-browser-profile
ANUNEKO_BROWSER_HEADLESS=false
ANUNEKO_CREATE_CHAT_BODY={"is_chose_persona":false}

BOT_ALLOWED_CHANNEL_IDS=
BOT_ENABLE_MENTION_REPLIES=true
BOT_COOLDOWN_MS=7000
BOT_DEBOUNCE_MS=2000
BOT_MAX_MESSAGE_LENGTH=500
ANUNEKO_TIMEOUT_MS=30000
```

`BOT_ALLOWED_CHANNEL_IDS` is optional. Leave it empty to allow all channels, or set a comma-separated list of Discord channel IDs.

## Local Login

Use this when running on your own machine:

1. Set `ANUNEKO_BROWSER_HEADLESS=false`.
2. Start the bot.
3. Log in to AnuNeko in the Chromium window that opens.
4. Use `/neko-new` or `/neko-link` in Discord.

The bot reuses `ANUNEKO_BROWSER_PROFILE_DIR` while that profile folder exists.

## Railway Notes

Railway cannot use the visible manual-login flow, so set:

```env
ANUNEKO_BROWSER_HEADLESS=true
```

This repo includes `railway.json`, which makes Railway run `npm run railway:build`.
That build downloads Chromium and its Linux dependencies with Playwright before
`npm run build`. The Railway start command also sets `PLAYWRIGHT_BROWSERS_PATH=0`
so the bot looks for the browser inside the deployed app instead of `/root/.cache`.

If the AnuNeko browser session expires on Railway, configure login credentials so the bot can refresh the browser session token automatically:

```env
ANUNEKO_LOGIN_URL=https://anuneko.com/api/v1/auth/login
ANUNEKO_LOGIN_ID=your_anuneko_email_or_username
ANUNEKO_PASSWORD=your_anuneko_password
ANUNEKO_LOGIN_ID_FIELD=email
ANUNEKO_PASSWORD_FIELD=password
```

If the login endpoint or field names are different, update those values before deploying. Railway's filesystem may be temporary unless you add a volume, so do not rely on the browser profile always surviving redeploys.

## Discord Permissions

Slash commands do not require privileged gateway intents. For normal channel messages, set `BOT_ENABLE_MENTION_REPLIES=true` and enable the Message Content Intent in the Discord Developer Portal.

The bot needs permission to:

- Read messages
- Send messages
- Use slash commands

## Commands

Channel chat links are in memory only. If the bot restarts, use `/neko-link` or `/neko-new` again in each channel that should talk to AnuNeko.

- `/neko-link chat-id:<id>` links the current channel to an existing AnuNeko chat ID. The bot stores the ID without validating it until the next channel message uses it.
- `/neko-new` creates a new AnuNeko chat immediately and links it to the current channel. If the channel was already linked, the new chat replaces the old link.
- `/neko-model model:<model>` changes the model for the current channel's linked chat. If the channel is not linked yet, the bot creates and links a new chat first, then applies the selected model.
