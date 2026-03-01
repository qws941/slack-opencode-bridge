import type { App } from "@slack/bolt";

import { abortSession } from "../services/opencode-client.js";
import type { HandlerDependencies } from "../types.js";

type ReactionItem = {
  type?: string;
  ts?: string;
};

type ReactionEvent = {
  reaction?: string;
  item?: ReactionItem;
};

function isReactionEvent(event: unknown): event is ReactionEvent {
  if (!event || typeof event !== "object") {
    return false;
  }
  return true;
}

export function registerReactionHandler(
  app: App,
  dependencies: HandlerDependencies,
): void {
  app.event("reaction_added", async ({ event, client }) => {
    if (!isReactionEvent(event)) {
      return;
    }

    const reaction = event.reaction;
    if (reaction !== "x" && reaction !== "octagonal_sign") {
      return;
    }

    const item = event.item;
    if (!item || item.type !== "message" || !item.ts) {
      return;
    }

    const session = dependencies.sessionStore.getSession(item.ts);
    if (!session) {
      return;
    }

    try {
      await abortSession(session.sessionId);
      dependencies.streamRenderer.stop(session.sessionId);
      dependencies.sessionStore.deleteSession(item.ts);

      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: item.ts,
        text: "🛑 Session aborted",
      });
    } catch (error) {
      console.error("Failed to abort session from reaction", error);
    }
  });
}
