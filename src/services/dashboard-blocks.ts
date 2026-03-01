import type { KnownBlock } from "@slack/types";

type SessionDashboardRow = {
  threadTs: string;
  sessionId: string;
  channelId: string;
  createdAt: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
};

type CostSummary = {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  sessionCount: number;
};

function normalizeCostDollars(cost: number): number {
  if (!Number.isFinite(cost)) {
    return 0;
  }

  if (Number.isInteger(cost) && Math.abs(cost) >= 1) {
    return cost / 100;
  }

  return cost;
}

function formatCost(cost: number): string {
  return `$${normalizeCostDollars(cost).toFixed(4)}`;
}

function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) {
    return "0";
  }

  const value = Math.abs(tokens);
  if (value >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }

  return `${Math.round(tokens)}`;
}

function formatAge(createdAt: number): string {
  const createdAtSeconds =
    createdAt > 1_000_000_000_000 ? createdAt / 1000 : createdAt;
  const ageSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1000 - createdAtSeconds),
  );

  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }
  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }
  if (ageSeconds < 86_400) {
    return `${Math.floor(ageSeconds / 3600)}h`;
  }
  return `${Math.floor(ageSeconds / 86_400)}d`;
}

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 14) {
    return sessionId;
  }

  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

export function buildStatusBlocks(
  activeSessions: SessionDashboardRow[],
): KnownBlock[] {
  const totalCost = activeSessions.reduce(
    (sum, session) => sum + session.totalCost,
    0,
  );
  const totalInput = activeSessions.reduce(
    (sum, session) => sum + session.inputTokens,
    0,
  );
  const totalOutput = activeSessions.reduce(
    (sum, session) => sum + session.outputTokens,
    0,
  );

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "OpenCode Status",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Active sessions:* ${activeSessions.length} | *Cost:* ${formatCost(totalCost)} | *Input:* ${formatTokenCount(totalInput)} | *Output:* ${formatTokenCount(totalOutput)}`,
      },
    },
    { type: "divider" },
  ];

  if (activeSessions.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No active sessions found." },
    });
    return blocks;
  }

  for (const session of activeSessions) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*Channel:* <#${session.channelId}>` },
        { type: "mrkdwn", text: `*Age:* ${formatAge(session.createdAt)}` },
        { type: "mrkdwn", text: `*Cost:* ${formatCost(session.totalCost)}` },
        {
          type: "mrkdwn",
          text: `*Tokens:* in ${formatTokenCount(session.inputTokens)} / out ${formatTokenCount(session.outputTokens)}`,
        },
      ],
    });
  }

  return blocks;
}

export function buildSessionListBlocks(
  sessions: SessionDashboardRow[],
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Recent Sessions",
        emoji: true,
      },
    },
  ];

  if (sessions.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No sessions found." },
    });
    return blocks;
  }

  for (const session of sessions) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${truncateSessionId(session.sessionId)}* | <#${session.channelId}> | ${formatCost(session.totalCost)} | in ${formatTokenCount(session.inputTokens)} / out ${formatTokenCount(session.outputTokens)} | age ${formatAge(session.createdAt)}`,
      },
    });
  }

  return blocks;
}

export function buildCostSummaryBlocks(summary: CostSummary): KnownBlock[] {
  const averageCost =
    summary.sessionCount > 0 ? summary.totalCost / summary.sessionCount : 0;

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Cost Summary",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Total Cost*\n${formatCost(summary.totalCost)}`,
        },
        {
          type: "mrkdwn",
          text: `*Avg/Session*\n${formatCost(averageCost)}`,
        },
        {
          type: "mrkdwn",
          text: `*Input Tokens*\n${formatTokenCount(summary.totalInput)}`,
        },
        {
          type: "mrkdwn",
          text: `*Output Tokens*\n${formatTokenCount(summary.totalOutput)}`,
        },
        {
          type: "mrkdwn",
          text: `*Sessions*\n${summary.sessionCount}`,
        },
      ],
    },
  ];
}
