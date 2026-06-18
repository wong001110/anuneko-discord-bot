export interface ChatSession {
  chatId?: string;
  lastMessageAt: number;
  model?: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  getSession(guildId: string, channelId: string): ChatSession {
    const key = this.getSessionKey(guildId, channelId);
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
    changes: Partial<ChatSession>,
  ): ChatSession {
    const session = this.getSession(guildId, channelId);
    const updatedSession = {
      ...session,
      ...changes,
    };

    this.sessions.set(this.getSessionKey(guildId, channelId), updatedSession);
    return updatedSession;
  }

  linkChat(guildId: string, channelId: string, chatId: string): ChatSession {
    return this.updateSession(guildId, channelId, {
      chatId,
      lastMessageAt: Date.now(),
    });
  }

  setModel(guildId: string, channelId: string, model: string): ChatSession {
    return this.updateSession(guildId, channelId, { model });
  }

  private getSessionKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }
}
