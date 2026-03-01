import { createHmac, timingSafeEqual } from "node:crypto";

import {
  buildAlertFallbackText,
  buildGlitchTipAlertBlocks,
  buildGlitchTipResolvedBlocks,
  getNotificationTier,
} from "../services/glitchtip-blocks.js";
import type { ChatUpdateClient } from "../types.js";
import type { GlitchTipIssueWebhook } from "../types/glitchtip.js";

export interface NotificationConfig {
  notificationChannel: string;
  alertDmUserId: string | null;
  webhookSecret: string | null;
}

type Issue = GlitchTipIssueWebhook["data"]["issue"];

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readIssueFromPayload(payload: unknown): Issue | null {
  const root = readObject(payload);
  const data = readObject(Reflect.get(root ?? {}, "data"));
  const issue = readObject(Reflect.get(data ?? {}, "issue"));
  if (!issue) {
    return null;
  }

  const title = Reflect.get(issue, "title");
  const webUrl = Reflect.get(issue, "web_url");
  const level = Reflect.get(issue, "level");
  const project = readObject(Reflect.get(issue, "project"));
  const metadata = readObject(Reflect.get(issue, "metadata"));
  if (
    typeof title !== "string" ||
    typeof webUrl !== "string" ||
    (level !== "fatal" &&
      level !== "error" &&
      level !== "warning" &&
      level !== "info" &&
      level !== "debug") ||
    !project ||
    !metadata
  ) {
    return null;
  }

  return issue as Issue;
}

function readAction(payload: unknown): string {
  const root = readObject(payload);
  const action = Reflect.get(root ?? {}, "action");
  return typeof action === "string" ? action : "created";
}

function verifySignature(
  rawBody: string,
  sentSignature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const sentBuffer = Buffer.from(sentSignature, "hex");

  if (expectedBuffer.length !== sentBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, sentBuffer);
}

async function postCriticalDm(
  issue: Issue,
  slackClient: ChatUpdateClient,
  alertDmUserId: string | null,
): Promise<void> {
  if (!alertDmUserId) {
    return;
  }

  const opened = await slackClient.conversations.open({ users: alertDmUserId });
  const openedObj = readObject(opened);
  const channelObj = readObject(Reflect.get(openedObj ?? {}, "channel"));
  const channelId = Reflect.get(channelObj ?? {}, "id");
  if (typeof channelId !== "string" || channelId.length === 0) {
    return;
  }

  await slackClient.chat.postMessage({
    channel: channelId,
    text: buildAlertFallbackText(issue),
    blocks: buildGlitchTipAlertBlocks(issue),
  });
}

async function postToChannel(
  issue: Issue,
  slackClient: ChatUpdateClient,
  notificationChannel: string,
  mode: "alert" | "resolved",
): Promise<void> {
  if (!notificationChannel) {
    return;
  }

  await slackClient.chat.postMessage({
    channel: notificationChannel,
    text:
      mode === "resolved"
        ? `✅ Resolved: ${issue.title}`
        : buildAlertFallbackText(issue),
    blocks:
      mode === "resolved"
        ? buildGlitchTipResolvedBlocks(issue)
        : buildGlitchTipAlertBlocks(issue),
  });
}

export async function handleGlitchTipWebhook(
  req: Request,
  slackClient: ChatUpdateClient,
  notificationConfig: NotificationConfig,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const issue = readIssueFromPayload(payload);
  if (!issue) {
    return new Response(
      JSON.stringify({ error: "Invalid issue webhook payload" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const secret = notificationConfig.webhookSecret;
  if (secret) {
    const signature = req.headers.get("Sentry-Hook-Signature");
    if (!signature || !verifySignature(rawBody, signature, secret)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const action = readAction(payload);
  if (action === "resolved") {
    await postToChannel(
      issue,
      slackClient,
      notificationConfig.notificationChannel,
      "resolved",
    );
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  const tier = getNotificationTier(issue);
  if (tier === "critical") {
    await postCriticalDm(issue, slackClient, notificationConfig.alertDmUserId);
    await postToChannel(
      issue,
      slackClient,
      notificationConfig.notificationChannel,
      "alert",
    );
  } else if (tier === "important") {
    await postToChannel(
      issue,
      slackClient,
      notificationConfig.notificationChannel,
      "alert",
    );
  } else {
    await postToChannel(
      issue,
      slackClient,
      notificationConfig.notificationChannel,
      "alert",
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
