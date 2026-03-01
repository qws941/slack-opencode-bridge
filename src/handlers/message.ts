import type { App } from "@slack/bolt";

import { sendPrompt } from "../services/opencode-client.js";
import type { HandlerDependencies } from "../types.js";

type UserMessageEvent = {
  text: string;
  thread_ts: string;
  channel: string;
  subtype?: string;
  bot_id?: string;
};

function isUserThreadMessage(event: unknown): event is UserMessageEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  const text = Reflect.get(event, "text");
  const threadTs = Reflect.get(event, "thread_ts");
  const channel = Reflect.get(event, "channel");
  const subtype = Reflect.get(event, "subtype");
  const botId = Reflect.get(event, "bot_id");

  return (
    typeof text === "string" &&
    typeof threadTs === "string" &&
    typeof channel === "string" &&
    (subtype === undefined || typeof subtype === "string") &&
    (botId === undefined || typeof botId === "string")
  );
}

export function registerMessageHandler(
  app: App,
  dependencies: HandlerDependencies,
): void {
  app.event("message", async ({ event, say }) => {
    if (!isUserThreadMessage(event)) {
      return;
    }

    if (event.bot_id || event.subtype) {
      return;
    }

    const session = dependencies.sessionStore.getSession(event.thread_ts);
    if (!session || session.channelId !== event.channel) {
      return;
    }

    const working = await say({
      text: "🔵 Working on it...",
      thread_ts: event.thread_ts,
    });

    const messageTs =
      working && typeof working === "object" && typeof working.ts === "string"
        ? working.ts
        : event.thread_ts;

    dependencies.streamRenderer.start(
      session.sessionId,
      event.channel,
      messageTs,
      event.thread_ts,
    );

    void sendPrompt(session.sessionId, event.text).catch(async (error) => {
      console.error("Failed to send follow-up prompt", error);
      dependencies.streamRenderer.stop(session.sessionId);
      await say({
        text: "❌ Failed to send follow-up prompt.",
        thread_ts: event.thread_ts,
      });
    });
  });
}
