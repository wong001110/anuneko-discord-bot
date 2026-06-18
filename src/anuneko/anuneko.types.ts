export interface SendMessageInput {
  message: string;
  chatId?: string;
  model?: string;
}

export interface SendMessageResult {
  text: string;
  chatId?: string;
}

export type AnuNekoErrorCode =
  | "expired_token"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "request_failed";

export class AnuNekoError extends Error {
  constructor(
    public readonly code: AnuNekoErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AnuNekoError";
  }
}
