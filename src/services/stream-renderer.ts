import { config } from "../config.js";
import type { ChatUpdateClient, OpenCodeEvent, StreamRenderer } from "../types.js";
import { formatMessage } from "./formatter.js";
import { subscribeEvents } from "./opencode-client.js";

type ActiveSession = {
  channel: string;
  messageTs: string;
  latestText: string;
  timer: ReturnType<typeof setTimeout> | null;
};

export class SlackStreamRenderer implements StreamRenderer {
  private readonly sessions = new Map<string, ActiveSession>();
  private streamTask: Promise<void> | null = null;
  private running = false;

  public constructor(private readonly slackClient: ChatUpdateClient) {}

  public start(sessionId: string, channel: string, messageTs: string): void {
    this.sessions.set(sessionId, {
      channel,
      messageTs,
      latestText: "",
      timer: null,
    });
    this.ensureStreamLoop();
  }

  public stop(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return;
    }

    if (existing.timer) {
      clearTimeout(existing.timer);
    }
    this.sessions.delete(sessionId);
  }

  private ensureStreamLoop(): void {
    if (this.streamTask) {
      return;
    }

    this.running = true;
    this.streamTask = this.consumeStream().finally(() => {
      this.streamTask = null;
      this.running = false;
    });
  }

  private async consumeStream(): Promise<void> {
    try {
      const stream = await subscribeEvents();
      for await (const event of stream) {
        if (!this.running) {
          break;
        }
        await this.handleEvent(event);
      }
    } catch (error) {
      console.error("Failed to consume OpenCode event stream", error);
    }
  }

  private async handleEvent(event: OpenCodeEvent): Promise<void> {
    if (event.type === "message.part.updated") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      const part = this.readPart(event);
      if (!part || part.type !== "text") {
        return;
      }

      session.latestText = part.text;
      this.scheduleFlush(sessionId);
      return;
    }

    if (event.type === "session.idle") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }
      await this.flush(sessionId);
      this.stop(sessionId);
      return;
    }

    if (event.type === "session.error") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      const errorMessage = this.readErrorMessage(event) ?? "Unknown OpenCode session error";
      await this.slackClient.chat.postMessage({
        channel: session.channel,
        thread_ts: session.messageTs,
        text: `❌ Session error: ${errorMessage}`,
      });

      this.stop(sessionId);
    }
  }

  private scheduleFlush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
    }

    session.timer = setTimeout(() => {
      session.timer = null;
      void this.flush(sessionId);
    }, config.STREAM_DEBOUNCE_MS);
  }

  private async flush(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const text = formatMessage(session.latestText || "\u2026");
    await this.slackClient.chat.update({
      channel: session.channel,
      ts: session.messageTs,
      text,
    });
  }

  private readSessionId(event: OpenCodeEvent): string | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const value = properties.sessionID;
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    return value;
  }

  private readPart(event: OpenCodeEvent): { type: string; text: string } | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const part = properties.part;
    if (!part || typeof part !== "object") {
      return null;
    }

    const partType = Reflect.get(part, "type");
    const partText = Reflect.get(part, "text");
    if (typeof partType !== "string" || typeof partText !== "string") {
      return null;
    }

    return { type: partType, text: partText };
  }

  private readErrorMessage(event: OpenCodeEvent): string | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const value = properties.error;
    return typeof value === "string" ? value : null;
  }
}
