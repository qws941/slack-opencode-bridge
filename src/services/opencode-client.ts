import { createOpencodeClient } from "@opencode-ai/sdk";

import { config } from "../config.js";
import type { OpenCodeEvent } from "../types.js";

const client = createOpencodeClient({ baseUrl: config.OPENCODE_BASE_URL });

function readSessionId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Unexpected session.create response payload");
  }

  const direct = Reflect.get(payload, "id");
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const data = Reflect.get(payload, "data");
  if (data && typeof data === "object") {
    const nested = Reflect.get(data, "id");
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }

  throw new Error("Unable to read session ID from response");
}

export async function createSession(title: string): Promise<string> {
  const response = await client.session.create({ body: { title } });
  return readSessionId(response);
}

export async function sendPrompt(
  sessionId: string,
  text: string,
): Promise<void> {
  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text,
        },
      ],
    },
  });
}

export async function abortSession(sessionId: string): Promise<void> {
  await client.session.abort({ path: { id: sessionId } });
}

export async function resolvePermission(
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    body: { response },
  });
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<OpenCodeEvent> {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Symbol.asyncIterator in value;
}

export async function subscribeEvents(): Promise<AsyncIterable<OpenCodeEvent>> {
  const subscription = await Promise.resolve(client.event.subscribe());
  if (!subscription || typeof subscription !== "object") {
    throw new Error("Unexpected event.subscribe() result");
  }

  const stream = Reflect.get(subscription, "stream");
  if (!isAsyncIterable(stream)) {
    throw new Error("event.subscribe() returned invalid stream");
  }

  return stream;
}

export { client as opencodeClient };
