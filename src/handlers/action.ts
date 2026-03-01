import type { App } from "@slack/bolt";

import { resolvePermission } from "../services/opencode-client.js";
import {
  type PermissionRequest,
  type PermissionResponse,
  buildPermissionResolvedBlocks,
} from "../services/permission-blocks.js";
import type { HandlerDependencies } from "../types.js";

type PermissionActionPayload = {
  sessionId: string;
  permissionId: string;
  response: PermissionResponse;
};

const ACTION_IDS = [
  "permission_approve",
  "permission_approve_always",
  "permission_deny",
] as const;

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseActionValue(rawValue: unknown): PermissionActionPayload | null {
  if (typeof rawValue !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }

  const objectValue = readObject(parsed);
  if (!objectValue) {
    return null;
  }

  const sessionId = Reflect.get(objectValue, "sessionId");
  const permissionId = Reflect.get(objectValue, "permissionId");
  const response = Reflect.get(objectValue, "response");
  if (
    typeof sessionId !== "string" ||
    typeof permissionId !== "string" ||
    (response !== "once" && response !== "always" && response !== "reject")
  ) {
    return null;
  }

  return { sessionId, permissionId, response };
}

function readActor(body: unknown): string {
  const bodyObj = readObject(body);
  if (!bodyObj) {
    return "unknown actor";
  }

  const user = readObject(Reflect.get(bodyObj, "user"));
  if (!user) {
    return "unknown actor";
  }

  const username = Reflect.get(user, "username");
  if (typeof username === "string" && username.length > 0) {
    return username;
  }

  const name = Reflect.get(user, "name");
  if (typeof name === "string" && name.length > 0) {
    return name;
  }

  const userId = Reflect.get(user, "id");
  if (typeof userId === "string" && userId.length > 0) {
    return `<@${userId}>`;
  }

  return "unknown actor";
}

function readMessageLocation(
  body: unknown,
): { channel: string; ts: string } | null {
  const bodyObj = readObject(body);
  if (!bodyObj) {
    return null;
  }

  const channelObj = readObject(Reflect.get(bodyObj, "channel"));
  const messageObj = readObject(Reflect.get(bodyObj, "message"));
  const channel = Reflect.get(channelObj ?? {}, "id");
  const ts = Reflect.get(messageObj ?? {}, "ts");
  if (typeof channel !== "string" || typeof ts !== "string") {
    return null;
  }

  return { channel, ts };
}

function readPermissionFromBody(
  body: unknown,
  fallback: PermissionActionPayload,
): PermissionRequest {
  const bodyObj = readObject(body);
  const messageObj = readObject(Reflect.get(bodyObj ?? {}, "message"));
  const blocks = Reflect.get(messageObj ?? {}, "blocks");

  let title = `Permission ${fallback.permissionId}`;
  let type = "unknown";
  if (Array.isArray(blocks)) {
    const firstBlock = readObject(blocks[0]);
    const textObj = readObject(Reflect.get(firstBlock ?? {}, "text"));
    const headerText = Reflect.get(textObj ?? {}, "text");
    if (typeof headerText === "string" && headerText.length > 0) {
      title = headerText;
    }

    const secondBlock = readObject(blocks[1]);
    const elements = Reflect.get(secondBlock ?? {}, "elements");
    if (Array.isArray(elements)) {
      for (const element of elements) {
        const elementObj = readObject(element);
        const elementText = Reflect.get(elementObj ?? {}, "text");
        if (typeof elementText !== "string") {
          continue;
        }
        const match = /\*Type:\*\s*(.+)$/m.exec(elementText);
        if (match?.[1]) {
          type = match[1].trim();
          break;
        }
      }
    }
  }

  return {
    id: fallback.permissionId,
    type,
    sessionID: fallback.sessionId,
    title,
    metadata: {},
    time: { created: Date.now() },
  };
}

async function updatePermissionMessage(
  client: unknown,
  channel: string,
  ts: string,
  text: string,
  blocks: Array<Record<string, unknown>>,
): Promise<void> {
  const clientObj = readObject(client);
  const chatObj = readObject(Reflect.get(clientObj ?? {}, "chat"));
  const updateValue = Reflect.get(chatObj ?? {}, "update");
  if (typeof updateValue !== "function") {
    throw new Error("Slack client chat.update is not available");
  }

  const callResult = Reflect.apply(updateValue, chatObj, [
    { channel, ts, text, blocks },
  ]);
  await Promise.resolve(callResult);
}

export function registerActionHandler(
  app: App,
  dependencies: HandlerDependencies,
): void {
  for (const actionId of ACTION_IDS) {
    app.action(actionId, async ({ ack, body, client }) => {
      await ack();

      const bodyObj = readObject(body);
      const actions = Reflect.get(bodyObj ?? {}, "actions");
      const firstAction = Array.isArray(actions) ? actions[0] : undefined;
      const actionObj = readObject(firstAction);
      const actionValue = Reflect.get(actionObj ?? {}, "value");
      const parsed = parseActionValue(actionValue);
      if (!parsed) {
        return;
      }

      dependencies.streamRenderer.cancelPermissionTimeout(parsed.permissionId);

      try {
        await resolvePermission(
          parsed.sessionId,
          parsed.permissionId,
          parsed.response,
        );
      } catch (error) {
        console.error("Failed to resolve permission", error);
        return;
      }

      const location = readMessageLocation(body);
      if (!location) {
        return;
      }

      const actor = readActor(body);
      const permission = readPermissionFromBody(body, parsed);
      const blocks = buildPermissionResolvedBlocks(
        permission,
        parsed.response,
        actor,
      );

      try {
        await updatePermissionMessage(
          client,
          location.channel,
          location.ts,
          `Permission ${parsed.permissionId} ${parsed.response} by ${actor}`,
          blocks,
        );
      } catch (error) {
        console.error("Failed to update permission message", error);
      }
    });
  }
}
