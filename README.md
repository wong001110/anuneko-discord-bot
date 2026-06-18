# Auto Reply Discord Bot

Private Discord bot MVP that sends Discord messages to an unofficial AnuNeko chat endpoint and replies with the response.

## Features

- `/neko <message>` slash command
- Optional mention-based replies
- Optional channel allowlist
- Per-user cooldown
- Message length limit
- In-memory session tracking
- Isolated AnuNeko adapter
- Polite user-facing fallback errors

## Setup

Requires Node.js 18.17 or newer.

1. Install dependencies:

   ```bash
   nvm use
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill in `.env`:

   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_application_client_id
   ANUNEKO_MODE=session
   ANUNEKO_SESSION_TOKEN=your_anuneko_browser_session_token
   ANUNEKO_BASE_URL=https://anuneko.com
   BOT_ALLOWED_CHANNEL_IDS=
   BOT_ENABLE_MENTION_REPLIES=false
   ```

   `BOT_ALLOWED_CHANNEL_IDS` is optional. Leave it empty to allow all channels, or set a comma-separated list of Discord channel IDs.
   `BOT_ENABLE_MENTION_REPLIES` is optional and defaults to `false`.

4. Build the project:

   ```bash
   npm run build
   ```

5. Start the bot:

   ```bash
   npm start
   ```

For development:

```bash
npm run dev
```

## Discord Permissions

Slash commands do not require privileged gateway intents. If you want mention-based replies, set `BOT_ENABLE_MENTION_REPLIES=true` and enable the Message Content Intent in the Discord Developer Portal.

The bot needs permission to:

- Read messages
- Send messages
- Use slash commands

## AnuNeko Adapter

The AnuNeko integration lives in `src/anuneko/anuneko.service.ts`.

### Direct Mode

Use direct mode if you already know the chat token and message endpoint:

```env
ANUNEKO_MODE=direct
ANUNEKO_TOKEN=your_anuneko_token
ANUNEKO_BASE_URL=https://example.com/anuneko/chat
```

### Auto Mode

Use auto mode if the bot should log in, create a chat, and use the returned chat URL/token:

```env
ANUNEKO_MODE=auto
ANUNEKO_LOGIN_URL=https://example.com/auth/login
ANUNEKO_CREATE_CHAT_URL=https://example.com/chats
ANUNEKO_LOGIN_ID=your_anuneko_email_or_username
ANUNEKO_PASSWORD=your_anuneko_password
ANUNEKO_LOGIN_ID_FIELD=email
ANUNEKO_PASSWORD_FIELD=password
ANUNEKO_MESSAGE_URL_TEMPLATE=
ANUNEKO_CREATE_CHAT_BODY=
```

Auto mode expects the login response to include a token-like field such as `accessToken`, `access_token`, `token`, `jwt`, `idToken`, or `sessionToken`.

It expects the create-chat response to include either:

- a message/chat URL field such as `messageUrl`, `message_url`, `chatUrl`, `chat_url`, `endpoint`, `url`, or `baseUrl`
- or a chat ID plus `ANUNEKO_MESSAGE_URL_TEMPLATE`, for example `https://example.com/chats/{chatId}/messages`

`ANUNEKO_CREATE_CHAT_BODY` is optional JSON for endpoints that need extra fields, for example:

```env
ANUNEKO_CREATE_CHAT_BODY={"model":"default"}
```

When sending chat messages, the adapter posts:

```json
{
  "message": "hello",
  "chatId": "optional-existing-session-id"
}
```

The adapter accepts several common response shapes such as:

```json
{ "text": "reply" }
```

```json
{ "message": "reply", "chatId": "session-id" }
```

```json
{ "reply": "reply" }
```

### AnuNeko Session Mode

Use session mode for the real `https://anuneko.com` web app. Log in with a browser, copy `localStorage.getItem("session_token")`, and set:

```env
ANUNEKO_MODE=session
ANUNEKO_SESSION_TOKEN=your_anuneko_browser_session_token
ANUNEKO_BASE_URL=https://anuneko.com
ANUNEKO_CREATE_CHAT_BODY={"is_chose_persona":false}
```

Session mode creates a chat through `/api/v1/chat`, sends messages to `/api/v1/msg/{chatId}/stream`, and reads AnuNeko's streamed `delta` events.

### AnuNeko Browser Mode

Use browser mode when copied session tokens are rejected. The bot launches a persistent Chromium profile, lets you log in once, and then sends API requests from that authenticated browser context.

```env
ANUNEKO_MODE=browser
ANUNEKO_BASE_URL=https://anuneko.com
ANUNEKO_BROWSER_PROFILE_DIR=.anuneko-browser-profile
ANUNEKO_BROWSER_HEADLESS=false
ANUNEKO_CREATE_CHAT_BODY={"is_chose_persona":false}
```

First-run flow:

1. Start the bot.
2. A visible Chromium window opens to AnuNeko.
3. Log in manually.
4. The bot reuses that browser profile on later restarts.

If the browser session expires or AnuNeko rejects it, the bot opens the same browser profile again and Discord receives the normal fallback message until you log in.

If the unofficial endpoint uses a different shape, update only the adapter rather than the Discord bot code.
