type PermissionRequest = {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionID: string;
  title: string;
  metadata: Record<string, unknown>;
  time: { created: number };
};

type PermissionResponse = "once" | "always" | "reject";

function formatTimestamp(created: number): string {
  const asMs = created < 1_000_000_000_000 ? created * 1000 : created;
  return new Date(asMs).toISOString();
}

function normalizePatterns(pattern?: string | string[]): string[] {
  if (typeof pattern === "string") {
    return pattern.length > 0 ? [pattern] : [];
  }
  if (!Array.isArray(pattern)) {
    return [];
  }

  const values: string[] = [];
  for (const item of pattern) {
    if (typeof item === "string" && item.length > 0) {
      values.push(item);
    }
  }
  return values;
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function responseText(response: string): string {
  if (response === "once") {
    return "Approved once";
  }
  if (response === "always") {
    return "Always allow";
  }
  if (response === "reject") {
    return "Denied";
  }
  return response;
}

export function buildPermissionBlocks(
  permission: PermissionRequest,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: permission.title,
      emoji: true,
    },
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*Type:* ${permission.type}`,
      },
      {
        type: "mrkdwn",
        text: `*Requested:* ${formatTimestamp(permission.time.created)}`,
      },
    ],
  });

  const patterns = normalizePatterns(permission.pattern);
  if (patterns.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Patterns*\n${patterns.map((item) => `• \`${item}\``).join("\n")}`,
      },
    });
  }

  const metadataEntries = Object.entries(permission.metadata ?? {}).slice(0, 6);
  if (metadataEntries.length > 0) {
    blocks.push({
      type: "section",
      fields: metadataEntries.map(([key, value]) => ({
        type: "mrkdwn",
        text: `*${key}*\n${formatMetadataValue(value)}`,
      })),
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Approve", emoji: true },
        style: "primary",
        action_id: "permission_approve",
        value: JSON.stringify({
          sessionId: permission.sessionID,
          permissionId: permission.id,
          response: "once" satisfies PermissionResponse,
        }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Always Allow", emoji: true },
        action_id: "permission_approve_always",
        value: JSON.stringify({
          sessionId: permission.sessionID,
          permissionId: permission.id,
          response: "always" satisfies PermissionResponse,
        }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "❌ Deny", emoji: true },
        style: "danger",
        action_id: "permission_deny",
        value: JSON.stringify({
          sessionId: permission.sessionID,
          permissionId: permission.id,
          response: "reject" satisfies PermissionResponse,
        }),
      },
    ],
  });

  return blocks;
}

export function buildPermissionResolvedBlocks(
  permission: PermissionRequest,
  response: string,
  actor: string,
): Array<Record<string, unknown>> {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: permission.title,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Type:* ${permission.type}`,
        },
        {
          type: "mrkdwn",
          text: `*Requested:* ${formatTimestamp(permission.time.created)}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Resolution:* ${responseText(response)} by ${actor}`,
      },
    },
  ];
}

export type { PermissionRequest, PermissionResponse };
