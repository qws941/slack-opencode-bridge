import type {
  GlitchTipIssueWebhook,
  NotificationTier,
} from "../types/glitchtip.js";

type Issue = GlitchTipIssueWebhook["data"]["issue"];

function levelEmoji(level: Issue["level"]): string {
  if (level === "fatal" || level === "error") {
    return "🔴";
  }
  if (level === "warning") {
    return "🟡";
  }
  return "🔵";
}

function levelBadge(level: Issue["level"]): string {
  return `\`${level.toUpperCase()}\``;
}

export function getNotificationTier(issue: Issue): NotificationTier {
  if (issue.level === "fatal") {
    return "critical";
  }

  if (issue.level === "error" && issue.priority === "high") {
    return "critical";
  }

  if (issue.level === "error" || issue.level === "warning") {
    return "important";
  }

  return "info";
}

export function buildAlertFallbackText(issue: Issue): string {
  return `${levelEmoji(issue.level)} [${issue.level.toUpperCase()}] ${issue.title} (${issue.project.name})`;
}

export function buildGlitchTipAlertBlocks(
  issue: Issue,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${levelEmoji(issue.level)} ${issue.title}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Project:* ${issue.project.name}`,
        },
        {
          type: "mrkdwn",
          text: `*Level:* ${levelBadge(issue.level)}`,
        },
        {
          type: "mrkdwn",
          text: `*Occurrences:* ${issue.count}`,
        },
        {
          type: "mrkdwn",
          text: `*First Seen:* ${issue.firstSeen}`,
        },
        {
          type: "mrkdwn",
          text: `*Last Seen:* ${issue.lastSeen}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Culprit*\n\`${issue.culprit || "(unknown)"}\``,
      },
    },
  ];

  if (issue.metadata.type && issue.metadata.value) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\`${issue.metadata.type}\`: ${issue.metadata.value}`,
      },
    });
  }

  if (issue.metadata.filename) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*File*\n\`${issue.metadata.filename}\``,
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View in GlitchTip", emoji: true },
        url: issue.web_url,
        action_id: "glitchtip_view",
      },
    ],
  });

  return blocks;
}

export function buildGlitchTipResolvedBlocks(
  issue: Issue,
): Array<Record<string, unknown>> {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `✅ Resolved: ${issue.title}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Project:* ${issue.project.name}`,
        },
        {
          type: "mrkdwn",
          text: `*Issue:* ${issue.short_id}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in GlitchTip", emoji: true },
          url: issue.web_url,
          action_id: "glitchtip_view",
        },
      ],
    },
  ];
}
