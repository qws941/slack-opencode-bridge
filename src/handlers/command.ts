import type { App } from "@slack/bolt";

import {
  buildCostSummaryBlocks,
  buildSessionListBlocks,
  buildStatusBlocks,
} from "../services/dashboard-blocks.js";
import type { HandlerDependencies } from "../types.js";

function buildHelpText(): string {
  return [
    "Usage: `/oc <subcommand>`",
    "• `status` - active sessions with cost/token summary",
    "• `sessions` - recent sessions with per-session cost",
    "• `cost` - aggregate cost totals",
    "• `help` - show this message",
  ].join("\n");
}

export function registerCommandHandler(
  app: App,
  dependencies: HandlerDependencies,
): void {
  app.command("/oc", async ({ command, ack, respond }) => {
    await ack();

    const text = command.text.trim();
    const [rawSubcommand = "", ...subcommandArgs] = text.length
      ? text.split(/\s+/)
      : [];
    const subcommand = rawSubcommand?.toLowerCase() ?? "";
    const argsText = subcommandArgs.join(" ");

    if (subcommand === "" || subcommand === "help") {
      await respond({
        text: buildHelpText(),
        response_type: "ephemeral",
      });
      return;
    }

    if (subcommand === "status") {
      const sessions = dependencies.sessionStore.getAllSessions();
      await respond({
        text: `OpenCode status: ${sessions.length} active session(s)`,
        blocks: buildStatusBlocks(sessions),
        response_type: "ephemeral",
      });
      return;
    }

    if (subcommand === "sessions") {
      const sessions = dependencies.sessionStore.getAllSessions();
      await respond({
        text: `OpenCode sessions: ${sessions.length} session(s)`,
        blocks: buildSessionListBlocks(sessions),
        response_type: "ephemeral",
      });
      return;
    }

    if (subcommand === "cost") {
      const summary = dependencies.sessionStore.getCostSummary();
      await respond({
        text: `OpenCode total cost: ${summary.totalCost}`,
        blocks: buildCostSummaryBlocks(summary),
        response_type: "ephemeral",
      });
      return;
    }

    await respond({
      text:
        argsText.length > 0
          ? `Unknown subcommand: ${subcommand} ${argsText}\n\n${buildHelpText()}`
          : `Unknown subcommand: ${subcommand}\n\n${buildHelpText()}`,
      response_type: "ephemeral",
    });
  });
}
