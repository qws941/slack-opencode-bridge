import type { App } from "@slack/bolt";

import { createSession, sendPrompt } from "../services/opencode-client.js";
import type { HandlerDependencies } from "../types.js";

type MentionEvent = {
  ts: string;
  thread_ts?: string;
  text?: string;
  channel: string;
};

function isMentionEvent(event: unknown): event is MentionEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  const ts = Reflect.get(event, "ts");
  const channel = Reflect.get(event, "channel");
  return typeof ts === "string" && typeof channel === "string";
}

function cleanMentionText(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

export function registerMentionHandler(
  app: App,
  dependencies: HandlerDependencies,
): void {
  app.event("app_mention", async ({ event, say }) => {
    if (!isMentionEvent(event)) {
      return;
    }

    const threadTs = event.thread_ts ?? event.ts;
    const promptText = cleanMentionText(event.text ?? "");

    if (!promptText) {
      await say({
        text: "Please include a prompt after mentioning the bot.",
        thread_ts: threadTs,
      });
      return;
    }

    try {
      const sessionId = await createSession(`Slack ${new Date().toISOString()}`);
      dependencies.sessionStore.setSession(threadTs, sessionId, event.channel);

      const working = await say({
        text: "🔵 Working on it...",
        thread_ts: threadTs,
      });

      const messageTs =
        working && typeof working === "object" && typeof working.ts === "string"
          ? working.ts
          : threadTs;

      dependencies.streamRenderer.start(sessionId, event.channel, messageTs, threadTs);

      void sendPrompt(sessionId, promptText).catch(async (error) => {
        console.error("Failed to send initial prompt", error);
        dependencies.streamRenderer.stop(sessionId);
        await say({
          text: "❌ Failed to send prompt to OpenCode.",
          thread_ts: threadTs,
        });
      });
    } catch (error) {
      console.error("Failed to initialize mention session", error);
      await say({
        text: "❌ Failed to create OpenCode session.",
        thread_ts: threadTs,
      });
    }
  });
}
