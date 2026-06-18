import { AnuNekoError, SendMessageInput, SendMessageResult } from "./anuneko.types.js";
import type { AnuNekoConfig } from "../config.js";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";

interface AnuNekoServiceOptions {
  config: AnuNekoConfig;
  timeoutMs: number;
}

type JsonRecord = Record<string, unknown>;

interface ChatTransport {
  url: string;
  token: string;
  chatId?: string;
}

interface BrowserFetchPayload {
  url: string;
  body: JsonRecord;
  accept: string;
  timeoutMs: number;
  fallbackDeviceId: string;
}

interface BrowserFetchResult {
  ok: boolean;
  status: number;
  text: string;
}

export class AnuNekoService {
  private autoChat?: ChatTransport;
  private browserContext?: BrowserContext;
  private browserPage?: Page;
  private browserPagePromise?: Promise<Page>;
  private browserLoginWaitPromise?: Promise<string>;
  private readonly deviceId = randomUUID();

  constructor(private readonly options: AnuNekoServiceOptions) {}

  async createChat(model?: string): Promise<string> {
    return this.withExpiredSessionRecovery(() => this.createChatOnce(model));
  }

  async updateChatModel(chatId: string, model: string): Promise<void> {
    await this.withExpiredSessionRecovery(() => this.updateChatModelOnce(chatId, model));
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.withExpiredSessionRecovery(() => this.sendMessageOnce(input));
  }

  private async createChatOnce(model?: string): Promise<string> {
    if (this.options.config.mode === "session") {
      const chatId = await this.createSessionChat();

      if (model) {
        await this.updateChatModel(chatId, model);
      }

      return chatId;
    }

    if (this.options.config.mode === "browser") {
      const chatId = await this.createBrowserChat();

      if (model) {
        await this.updateChatModel(chatId, model);
      }

      return chatId;
    }

    if (this.options.config.mode === "auto") {
      if (model) {
        throw new AnuNekoError(
          "request_failed",
          "Changing models is not supported in auto mode",
        );
      }

      this.autoChat = await this.createAutoChat();

      if (!this.autoChat.chatId) {
        throw new AnuNekoError("invalid_response", "AnuNeko chat creation did not return a chat ID");
      }

      return this.autoChat.chatId;
    }

    throw new AnuNekoError(
      "request_failed",
      "Creating chats is not supported in direct mode",
    );
  }

  private async updateChatModelOnce(chatId: string, model: string): Promise<void> {
    if (this.options.config.mode === "session") {
      await this.postSessionRequest(
        getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/user/select_model"),
        this.options.config.sessionToken,
        { chat_id: chatId, model },
        "application/json",
      );
      return;
    }

    if (this.options.config.mode === "browser") {
      await this.postBrowserRequest(
        getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/user/select_model"),
        { chat_id: chatId, model },
        "application/json",
      );
      return;
    }

    throw new AnuNekoError(
      "request_failed",
      `Changing models is not supported in ${this.options.config.mode} mode`,
    );
  }

  private async withExpiredSessionRecovery<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AnuNekoError && error.code === "expired_token") {
        if (this.options.config.mode === "auto") {
          this.autoChat = undefined;
          return operation();
        }

        if (this.options.config.mode === "browser" && !this.options.config.browserHeadless) {
          const page = await this.getBrowserPage();
          await this.waitForBrowserLogin(page);
          return operation();
        }

        if (this.options.config.mode === "browser" && this.options.config.browserHeadless) {
          const config = this.options.config;

          if (config.loginUrl && config.loginId && config.password) {
            const loginData = await this.postJsonWithoutAuth(config.loginUrl, {
              [config.loginIdField ?? "email"]: config.loginId,
              [config.passwordField ?? "password"]: config.password,
            });
            const token = firstStringDeep(loginData, [
              "accessToken",
              "access_token",
              "token",
              "jwt",
              "sessionToken",
            ]);

            if (token) {
              await this.injectBrowserSessionToken(token);
              return operation();
            }
          }
        }
      }

      throw error;
    }
  }

  private async sendMessageOnce(input: SendMessageInput): Promise<SendMessageResult> {
    if (this.options.config.mode === "session") {
      return this.sendSessionMessage(input);
    }

    if (this.options.config.mode === "browser") {
      return this.sendBrowserMessage(input);
    }

    const transport = await this.getChatTransport(input.chatId);
    const data = await this.postJson(transport.url, transport.token, {
      message: input.message,
      chatId: input.chatId ?? transport.chatId,
    });

    const result = this.parseMessageResponse(data);

    return {
      text: result.text,
      chatId: result.chatId ?? input.chatId ?? transport.chatId,
    };
  }

  private async getChatTransport(chatId?: string): Promise<ChatTransport> {
    if (this.options.config.mode === "direct") {
      return {
        url: this.options.config.baseUrl,
        token: this.options.config.token,
        chatId,
      };
    }

    if (this.autoChat) {
      return this.autoChat;
    }

    this.autoChat = await this.createAutoChat();
    return this.autoChat;
  }

  private async sendSessionMessage(
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    if (this.options.config.mode !== "session") {
      throw new AnuNekoError("request_failed", "Session chat requested in another mode");
    }

    const chatId = input.chatId ?? (await this.createSessionChat(input.model));
    const response = await this.postSessionRequest(
      getAnuNekoApiUrl(this.options.config.baseUrl, `/api/v1/msg/${chatId}/stream`),
      this.options.config.sessionToken,
      {
        contents: [input.message],
      },
      "text/event-stream",
    );
    const text = await response.text();
    const { reply, msgId } = parseAnuNekoEventStream(text);

    if (!reply) {
      throw new AnuNekoError("invalid_response", "AnuNeko stream did not include text");
    }

    if (msgId) {
      void this.confirmChoice(
        getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/msg/select-choice"),
        this.options.config.sessionToken,
        msgId,
      );
    }

    return {
      text: reply,
      chatId,
    };
  }

  private async createSessionChat(model?: string): Promise<string> {
    if (this.options.config.mode !== "session") {
      throw new AnuNekoError("request_failed", "Session chat requested in another mode");
    }

    const response = await this.postSessionRequest(
      getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/chat"),
      this.options.config.sessionToken,
      this.options.config.createChatBody ?? {
        is_chose_persona: false,
      },
      "application/json",
    );
    const data = unwrapAnuNekoApiData(await this.readJson(response));
    const chatId = firstStringDeep(data, [
      "chat_id",
      "chatId",
      "id",
      "conversationId",
      "conversation_id",
      "sessionId",
    ]);

    if (!chatId) {
      throw new AnuNekoError("invalid_response", "AnuNeko chat creation did not return a chat ID");
    }

    if (model) {
      void this.confirmSessionModel(chatId, model);
    }

    return chatId;
  }

  private confirmSessionModel(chatId: string, model: string): Promise<void> {
    const config = this.options.config;

    if (config.mode !== "session") {
      return Promise.resolve();
    }

    return this.postSessionRequest(
      getAnuNekoApiUrl(config.baseUrl, "/api/v1/user/select_model"),
      config.sessionToken,
      { chat_id: chatId, model },
      "application/json",
    )
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async sendBrowserMessage(
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser chat requested in another mode");
    }

    try {
      const chatId = input.chatId ?? (await this.createBrowserChat(input.model));
      const result = await this.postBrowserRequest(
        getAnuNekoApiUrl(this.options.config.baseUrl, `/api/v1/msg/${chatId}/stream`),
        {
          contents: [input.message],
        },
        "text/event-stream",
      );
      const { reply, msgId } = parseAnuNekoEventStream(result.text);

      if (!reply) {
        throw new AnuNekoError("invalid_response", "AnuNeko stream did not include text");
      }

      if (msgId) {
        void this.confirmChoiceBrowser(
          getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/msg/select-choice"),
          msgId,
        );
      }

      return {
        text: reply,
        chatId,
      };
    } catch (error) {
      if (error instanceof AnuNekoError && error.code === "expired_token") {
        await this.openBrowserLoginPage().catch(() => undefined);
      }

      throw error;
    }
  }

  private async createBrowserChat(model?: string): Promise<string> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser chat requested in another mode");
    }

    const result = await this.postBrowserRequest(
      getAnuNekoApiUrl(this.options.config.baseUrl, "/api/v1/chat"),
      this.options.config.createChatBody ?? {
        is_chose_persona: false,
      },
      "application/json",
    );
    const data = unwrapAnuNekoApiData(this.parseJsonText(result.text));
    const chatId = firstStringDeep(data, [
      "chat_id",
      "chatId",
      "id",
      "conversationId",
      "conversation_id",
      "sessionId",
    ]);

    if (!chatId) {
      throw new AnuNekoError("invalid_response", "AnuNeko chat creation did not return a chat ID");
    }

    if (model) {
      void this.confirmBrowserModel(chatId, model);
    }

    return chatId;
  }

  private confirmBrowserModel(chatId: string, model: string): Promise<void> {
    const config = this.options.config;

    if (config.mode !== "browser") {
      return Promise.resolve();
    }

    return this.postBrowserRequest(
      getAnuNekoApiUrl(config.baseUrl, "/api/v1/user/select_model"),
      { chat_id: chatId, model },
      "application/json",
    )
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async createAutoChat(): Promise<ChatTransport> {
    if (this.options.config.mode !== "auto") {
      throw new AnuNekoError("request_failed", "Auto chat requested in direct mode");
    }

    const loginData = await this.postJsonWithoutAuth(this.options.config.loginUrl, {
      [this.options.config.loginIdField]: this.options.config.loginId,
      [this.options.config.passwordField]: this.options.config.password,
    });
    const loginToken = firstStringDeep(loginData, [
      "accessToken",
      "access_token",
      "token",
      "jwt",
      "idToken",
      "sessionToken",
    ]);

    if (!loginToken) {
      throw new AnuNekoError("invalid_response", "AnuNeko login did not return a token");
    }

    const createChatData = await this.postJson(
      this.options.config.createChatUrl,
      loginToken,
      this.options.config.createChatBody ?? {},
    );
    const chatId = firstStringDeep(createChatData, [
      "chatId",
      "chat_id",
      "conversationId",
      "conversation_id",
      "sessionId",
    ]);
    const chatToken =
      firstStringDeep(createChatData, [
        "chatToken",
        "chat_token",
        "accessToken",
        "access_token",
        "token",
        "jwt",
        "sessionToken",
      ]) ?? loginToken;
    const chatUrl =
      firstStringDeep(createChatData, [
        "messageUrl",
        "message_url",
        "chatUrl",
        "chat_url",
        "endpoint",
        "url",
        "baseUrl",
        "base_url",
      ]) ?? getMessageUrlFromTemplate(this.options.config.messageUrlTemplate, chatId);

    if (!chatUrl) {
      throw new AnuNekoError(
        "invalid_response",
        "AnuNeko chat creation did not return a message URL",
      );
    }

    return {
      url: chatUrl,
      token: chatToken,
      chatId,
    };
  }

  private async injectBrowserSessionToken(token: string): Promise<void> {
    const page = await this.getBrowserPage();
    await page.evaluate((t) => {
      localStorage.setItem("session_token", t);
      localStorage.setItem("sessionToken", t);
    }, token);
  }

  private confirmChoice(url: string, token: string, msgId: string): Promise<void> {
    return this.postSessionRequest(url, token, { msg_id: msgId, choice_idx: 0 }, "application/json")
      .then(() => undefined)
      .catch(() => undefined);
  }

  private confirmChoiceBrowser(url: string, msgId: string): Promise<void> {
    return this.postBrowserRequest(url, { msg_id: msgId, choice_idx: 0 }, "application/json")
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async postJsonWithoutAuth(url: string, body: JsonRecord): Promise<unknown> {
    return this.postJsonRequest(url, undefined, body);
  }

  private async postJson(
    url: string,
    token: string,
    body: JsonRecord,
  ): Promise<unknown> {
    return this.postJsonRequest(url, token, body);
  }

  private async postJsonRequest(
    url: string,
    token: string | undefined,
    body: JsonRecord,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new AnuNekoError("expired_token", "AnuNeko token was rejected");
      }

      if (response.status === 429) {
        throw new AnuNekoError("rate_limited", "AnuNeko rate limit reached");
      }

      if (!response.ok) {
        throw new AnuNekoError(
          "request_failed",
          `AnuNeko request failed with status ${response.status}`,
        );
      }

      const data = await this.readJson(response);
      return data;
    } catch (error) {
      if (error instanceof AnuNekoError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new AnuNekoError("timeout", "AnuNeko request timed out", error);
      }

      throw new AnuNekoError("request_failed", "AnuNeko request failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postSessionRequest(
    url: string,
    token: string,
    body: JsonRecord,
    accept: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getSessionHeaders(token, accept),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new AnuNekoError("expired_token", "AnuNeko session token was rejected");
      }

      if (response.status === 429) {
        throw new AnuNekoError("rate_limited", "AnuNeko rate limit reached");
      }

      if (!response.ok) {
        throw new AnuNekoError(
          "request_failed",
          `AnuNeko request failed with status ${response.status}`,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AnuNekoError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new AnuNekoError("timeout", "AnuNeko request timed out", error);
      }

      throw new AnuNekoError("request_failed", "AnuNeko request failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postBrowserRequest(
    url: string,
    body: JsonRecord,
    accept: string,
  ): Promise<BrowserFetchResult> {
    const page = await this.getBrowserPage();
    await this.ensureBrowserAuthenticated(page);

    try {
      const result = await page.evaluate(
        async (payload: BrowserFetchPayload): Promise<BrowserFetchResult> => {
          const token =
            localStorage.getItem("session_token") ??
            localStorage.getItem("sessionToken") ??
            sessionStorage.getItem("session_token") ??
            sessionStorage.getItem("sessionToken");

          if (!token) {
            return {
              ok: false,
              status: 401,
              text: "AnuNeko browser login is required",
            };
          }

          const deviceId =
            localStorage.getItem("device_id") ??
            localStorage.getItem("deviceId") ??
            payload.fallbackDeviceId;
          const timezone = (-new Date().getTimezoneOffset() / 60).toString();
          const browserScreen = (globalThis as {
            screen?: { width: number; height: number };
          }).screen;
          const screenResolution =
            !browserScreen
              ? "1440x900"
              : `${browserScreen.width}x${browserScreen.height}`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), payload.timeoutMs);

          try {
            const response = await fetch(payload.url, {
              method: "POST",
              headers: {
                Accept: payload.accept,
                "Content-Type": "application/json",
                "x-token": token,
                "x-device_id": deviceId,
                "x-timezone": timezone,
                "x-client_type": "4",
                "X-Screen_Resolution": screenResolution,
              },
              body: JSON.stringify(payload.body),
              credentials: "include",
              signal: controller.signal,
            });

            return {
              ok: response.ok,
              status: response.status,
              text: await response.text(),
            };
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          url,
          body,
          accept,
          timeoutMs: this.options.timeoutMs,
          fallbackDeviceId: this.deviceId,
        },
      );

      if (result.status === 401 || result.status === 403) {
        throw new AnuNekoError("expired_token", "AnuNeko browser session was rejected");
      }

      if (result.status === 429) {
        throw new AnuNekoError("rate_limited", "AnuNeko rate limit reached");
      }

      if (!result.ok) {
        throw new AnuNekoError(
          "request_failed",
          `AnuNeko request failed with status ${result.status}`,
        );
      }

      return result;
    } catch (error) {
      if (error instanceof AnuNekoError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new AnuNekoError("timeout", "AnuNeko request timed out", error);
      }

      throw new AnuNekoError("request_failed", "AnuNeko browser request failed", error);
    }
  }

  private async getBrowserPage(): Promise<Page> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser requested in another mode");
    }

    if (!this.browserPagePromise) {
      this.browserPagePromise = this.createBrowserPage();
    }

    return this.browserPagePromise;
  }

  private async createBrowserPage(): Promise<Page> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser requested in another mode");
    }

    try {
      const context = await chromium.launchPersistentContext(
        this.options.config.browserProfileDir,
        {
          headless: this.options.config.browserHeadless,
          viewport: {
            width: 1440,
            height: 900,
          },
        },
      );
      const page = context.pages()[0] ?? (await context.newPage());

      page.setDefaultTimeout(this.options.timeoutMs);
      page.setDefaultNavigationTimeout(this.options.timeoutMs);

      this.browserContext = context;
      this.browserPage = page;
      await this.navigateBrowserToBaseUrl(page);

      return page;
    } catch (error) {
      this.browserPagePromise = undefined;
      throw new AnuNekoError("request_failed", "Failed to start AnuNeko browser", error);
    }
  }

  private async ensureBrowserAuthenticated(page: Page): Promise<string> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser requested in another mode");
    }

    const token = await this.getBrowserSessionToken(page);

    if (token) {
      return token;
    }

    await this.openBrowserLoginPage();

    if (this.options.config.browserHeadless) {
      throw new AnuNekoError(
        "expired_token",
        "AnuNeko browser login is required, but the browser is headless",
      );
    }

    if (!this.browserLoginWaitPromise) {
      this.browserLoginWaitPromise = this.waitForBrowserLogin(page).finally(() => {
        this.browserLoginWaitPromise = undefined;
      });
    }

    return this.browserLoginWaitPromise;
  }

  private async waitForBrowserLogin(page: Page): Promise<string> {
    try {
      await page.waitForFunction(
        () =>
          Boolean(
            localStorage.getItem("session_token") ??
              localStorage.getItem("sessionToken") ??
              sessionStorage.getItem("session_token") ??
              sessionStorage.getItem("sessionToken"),
          ),
        undefined,
        {
          timeout: this.options.timeoutMs,
        },
      );
    } catch (error) {
      throw new AnuNekoError("expired_token", "AnuNeko browser login is required", error);
    }

    const token = await this.getBrowserSessionToken(page);

    if (!token) {
      throw new AnuNekoError("expired_token", "AnuNeko browser login is required");
    }

    return token;
  }

  private async openBrowserLoginPage(): Promise<void> {
    if (this.options.config.mode !== "browser") {
      return;
    }

    const page = this.browserPage ?? (await this.getBrowserPage());
    await this.navigateBrowserToBaseUrl(page);
    await page.bringToFront().catch(() => undefined);
  }

  private async navigateBrowserToBaseUrl(page: Page): Promise<void> {
    if (this.options.config.mode !== "browser") {
      throw new AnuNekoError("request_failed", "Browser requested in another mode");
    }

    if (isSameOrigin(page.url(), this.options.config.baseUrl)) {
      return;
    }

    await page.goto(this.options.config.baseUrl, {
      waitUntil: "domcontentloaded",
    });
  }

  private async getBrowserSessionToken(page: Page): Promise<string | undefined> {
    try {
      await this.navigateBrowserToBaseUrl(page);
      const token = await page.evaluate(
        () =>
          localStorage.getItem("session_token") ??
          localStorage.getItem("sessionToken") ??
          sessionStorage.getItem("session_token") ??
          sessionStorage.getItem("sessionToken"),
      );

      return typeof token === "string" && token.trim() ? token.trim() : undefined;
    } catch (error) {
      throw new AnuNekoError("request_failed", "Failed to read AnuNeko browser session", error);
    }
  }

  private getSessionHeaders(token: string, accept: string): Record<string, string> {
    return {
      Accept: accept,
      "Content-Type": "application/json",
      "x-token": token,
      "x-device_id": this.deviceId,
      "x-timezone": (-new Date().getTimezoneOffset() / 60).toString(),
      "x-client_type": "4",
      "X-Screen_Resolution": "1440x900",
    };
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new AnuNekoError("invalid_response", "AnuNeko returned invalid JSON", error);
    }
  }

  private parseMessageResponse(data: unknown): SendMessageResult {
    if (!isJsonRecord(data)) {
      throw new AnuNekoError("invalid_response", "AnuNeko returned a non-object response");
    }

    const text = firstStringDeep(data, ["text", "reply", "message", "content", "answer"]);
    const chatId = firstStringDeep(data, [
      "chatId",
      "chat_id",
      "conversationId",
      "conversation_id",
      "sessionId",
    ]);

    if (!text) {
      throw new AnuNekoError("invalid_response", "AnuNeko response did not include text");
    }

    return {
      text,
      chatId,
    };
  }

  private parseJsonText(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new AnuNekoError("invalid_response", "AnuNeko returned invalid JSON", error);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstStringDeep(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = firstStringDeep(item, keys);

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  if (!isJsonRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const fieldValue = value[key];

    if (typeof fieldValue === "string" && fieldValue.trim()) {
      return fieldValue.trim();
    }
  }

  for (const fieldValue of Object.values(value)) {
    const match = firstStringDeep(fieldValue, keys);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function getMessageUrlFromTemplate(
  template: string | undefined,
  chatId: string | undefined,
): string | undefined {
  if (!template || !chatId) {
    return undefined;
  }

  return template.replaceAll("{chatId}", encodeURIComponent(chatId));
}

function getAnuNekoApiUrl(baseUrl: string, path: string): string {
  return new URL(path, withTrailingSlash(baseUrl)).toString();
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isSameOrigin(currentUrl: string, targetUrl: string): boolean {
  try {
    return new URL(currentUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

function unwrapAnuNekoApiData(data: unknown): unknown {
  if (!isJsonRecord(data) || typeof data.code !== "number") {
    return data;
  }

  if (data.code !== 0) {
    const message =
      typeof data.msg === "string" && data.msg.trim()
        ? data.msg.trim()
        : `AnuNeko returned code ${data.code}`;

    throw new AnuNekoError("request_failed", message);
  }

  return data.data ?? data;
}

function parseAnuNekoEventStream(text: string): { reply: string; msgId?: string } {
  let reply = "";
  let msgId: string | undefined;

  for (const event of parseServerSentEvents(text)) {
    if (event.event === "error") {
      const detail =
        event.data && isJsonRecord(event.data) && typeof event.data.detail === "string"
          ? event.data.detail
          : "AnuNeko stream returned an error";

      throw new AnuNekoError("request_failed", detail);
    }

    if (!isJsonRecord(event.data)) {
      continue;
    }

    if (typeof event.data.msg_id === "string" && event.data.msg_id) {
      msgId = event.data.msg_id;
    }

    if (event.event !== "delta") {
      continue;
    }

    if (typeof event.data.v === "string") {
      reply += event.data.v;
      continue;
    }

    if (Array.isArray(event.data.c)) {
      for (const choice of event.data.c) {
        if (isJsonRecord(choice) && typeof choice.v === "string") {
          reply += choice.v;
        }
      }
    }
  }

  return { reply: reply.trim(), msgId };
}

function parseServerSentEvents(
  text: string,
): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = text.replaceAll("\r\n", "\n").split("\n\n");

  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const dataText = dataLines.join("\n");

    try {
      events.push({
        event,
        data: JSON.parse(dataText) as unknown,
      });
    } catch {
      events.push({
        event,
        data: dataText,
      });
    }
  }

  return events;
}
