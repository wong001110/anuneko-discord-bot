export interface ChatSession {
  chatId?: string;
  lastMessageAt: number;
  model?: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  getSession(guildId: string, channelId: string, userId: string): ChatSession {
    const key = this.getSessionKey(guildId, channelId, userId);
    const existingSession = this.sessions.get(key);

    if (existingSession) {
      return existingSession;
    }

    const session: ChatSession = {
      lastMessageAt: 0,
    };

    this.sessions.set(key, session);
    return session;
  }

  updateSession(
    guildId: string,
    channelId: string,
    userId: string,
    changes: Partial<ChatSession>,
  ): ChatSession {
    const session = this.getSession(guildId, channelId, userId);
    const updatedSession = {
      ...session,
      ...changes,
    };

    this.sessions.set(this.getSessionKey(guildId, channelId, userId), updatedSession);
    return updatedSession;
  }

  clearSession(guildId: string, channelId: string, userId: string): void {
    const key = this.getSessionKey(guildId, channelId, userId);
    const existing = this.sessions.get(key);

    if (existing) {
      this.sessions.set(key, { lastMessageAt: existing.lastMessageAt, model: existing.model });
    }
  }

  setModel(guildId: string, channelId: string, userId: string, model: string): void {
    this.updateSession(guildId, channelId, userId, { chatId: undefined, model });
  }

  private getSessionKey(guildId: string, channelId: string, _userId: string): string {
    return `${guildId}:${channelId}`;
  }
}
