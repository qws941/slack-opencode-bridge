export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SessionMapping {
  sessionId: string;
  channelId: string;
}

export interface SessionStore {
  setSession(threadTs: string, sessionId: string, channelId: string): void;
  getSession(threadTs: string): SessionMapping | null;
  deleteSession(threadTs: string): void;
}

export interface StreamRenderer {
  start(sessionId: string, channel: string, messageTs: string): void;
  stop(sessionId: string): void;
}

export interface HandlerDependencies {
  sessionStore: SessionStore;
  streamRenderer: StreamRenderer;
}

export interface ChatUpdateClient {
  chat: {
    update(args: { channel: string; ts: string; text: string }): Promise<unknown>;
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<unknown>;
  };
}

export type OpenCodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
};
