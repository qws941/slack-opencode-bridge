import type { App } from "@slack/bolt";

import {
  abortSession,
  createSession,
  sendPrompt,
} from "../services/opencode-client.js";
import type { HandlerDependencies } from "../types.js";

type ReactionItem = {
  type?: string;
  ts?: string;
  channel?: string;
};

type ReactionEvent = {
  reaction?: string;
  item?: ReactionItem;
};

type GlitchTipAlertSummary = {
  title: string;
  culprit: string;
};

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractTextContent(textObj: unknown): string {
  const obj = readObject(textObj);
  const text = Reflect.get(obj ?? {}, "text");
  return typeof text === "string" ? text : "";
}

function parseGlitchTipAlertFromBlocks(
  blocksValue: unknown,
): GlitchTipAlertSummary | null {
  if (!Array.isArray(blocksValue)) {
    return null;
  }

  let hasGlitchTipAction = false;
  let title = "";
  let culprit = "";

  for (const block of blocksValue) {
    const blockObj = readObject(block);
    const blockType = Reflect.get(blockObj ?? {}, "type");

    if (blockType === "header") {
      const text = extractTextContent(Reflect.get(blockObj ?? {}, "text"));
      if (text.length > 0) {
        title = text;
      }
      continue;
    }

    if (blockType === "section") {
      const sectionText = extractTextContent(
        Reflect.get(blockObj ?? {}, "text"),
      );
      if (sectionText.includes("*Culprit*")) {
        const culpritMatch = /\*Culprit\*\n`([^`]+)`/m.exec(sectionText);
        culprit = culpritMatch?.[1]?.trim() ?? "";
      }
      continue;
    }

    if (blockType !== "actions") {
      continue;
    }

    const elements = Reflect.get(blockObj ?? {}, "elements");
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      const elementObj = readObject(element);
      const actionId = Reflect.get(elementObj ?? {}, "action_id");
      const text = extractTextContent(Reflect.get(elementObj ?? {}, "text"));
      const url = Reflect.get(elementObj ?? {}, "url");
      if (
        actionId === "glitchtip_view" ||
        text === "View in GlitchTip" ||
        (typeof url === "string" && /glitchtip|sentry/i.test(url))
      ) {
        hasGlitchTipAction = true;
      }
    }
  }

  if (!hasGlitchTipAction) {
    return null;
  }

  return {
    title: title || "GlitchTip alert",
    culprit: culprit || "unknown location",
  };
}

async function loadGlitchTipAlertSummary(
  client: App["client"],
  channel: string,
  ts: string,
): Promise<GlitchTipAlertSummary | null> {
  const history = await client.conversations.history({
    channel,
    latest: ts,
    inclusive: true,
    limit: 1,
  });

  const historyObj = readObject(history);
  const messagesValue = Reflect.get(historyObj ?? {}, "messages");
  if (!Array.isArray(messagesValue) || messagesValue.length === 0) {
    return null;
  }

  const messageObj = readObject(messagesValue[0]);
  const blocks = Reflect.get(messageObj ?? {}, "blocks");
  return parseGlitchTipAlertFromBlocks(blocks);
}

async function runGlitchTipAutoTriage(
  event: ReactionEvent,
  client: App["client"],
  dependencies: HandlerDependencies,
): Promise<void> {
  const item = event.item;
  if (!item || item.type !== "message" || !item.ts || !item.channel) {
    return;
  }
  const channel = item.channel;
  const threadTs = item.ts;

  const summary = await loadGlitchTipAlertSummary(client, channel, threadTs);
  if (!summary) {
    return;
  }

  const sessionId = await createSession(
    `GlitchTip ${new Date().toISOString()}`,
  );
  dependencies.sessionStore.setSession(threadTs, sessionId, channel);

  const triageMessage = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "🔧 Auto-triage started — investigating error...",
  });

  const triageObj = readObject(triageMessage);
  const messageTs = Reflect.get(triageObj ?? {}, "ts");
  const streamMessageTs = typeof messageTs === "string" ? messageTs : threadTs;

  dependencies.streamRenderer.start(
    sessionId,
    channel,
    streamMessageTs,
    threadTs,
  );

  const prompt = `Investigate this GlitchTip error: ${summary.title} at ${summary.culprit}. Analyze the error and suggest a fix.`;

  void sendPrompt(sessionId, prompt).catch(async (error) => {
    console.error("Failed to send GlitchTip auto-triage prompt", error);
    dependencies.streamRenderer.stop(sessionId);
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "❌ Auto-triage failed to start.",
    });
  });
}

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
    if (reaction === "wrench") {
      try {
        await runGlitchTipAutoTriage(event, client, dependencies);
      } catch (error) {
        console.error("Failed to run GlitchTip auto-triage", error);
      }
      return;
    }

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
