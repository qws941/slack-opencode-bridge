import { createApp } from "./app.js";
import { config } from "./config.js";
import { SqliteSessionStore } from "./services/session-store.js";
import { SlackStreamRenderer } from "./services/stream-renderer.js";

const sessionStore = new SqliteSessionStore(config.DB_PATH);
const app = createApp({
  sessionStore,
  streamRenderer: new SlackStreamRenderer(appClientShim()),
});
const cleanupInterval = setInterval(() => {
  const removed = sessionStore.cleanupExpiredSessions(
    config.SESSION_TIMEOUT_SECONDS,
  );
  console.log(`[cleanup] removed ${removed} expired sessions`);
}, config.CLEANUP_INTERVAL_MS);

function appClientShim() {
  return {
    chat: {
      update: (args: {
        channel: string;
        ts: string;
        text: string;
        blocks?: Array<Record<string, unknown>>;
      }) => app.client.chat.update(args),
      postMessage: (args: {
        channel: string;
        text: string;
        thread_ts?: string;
        blocks?: Array<Record<string, unknown>>;
      }) => app.client.chat.postMessage(args),
    },
    reactions: {
      add: (args: { channel: string; timestamp: string; name: string }) =>
        app.client.reactions.add(args),
      remove: (args: { channel: string; timestamp: string; name: string }) =>
        app.client.reactions.remove(args),
    },
  };
}

async function start(): Promise<void> {
  startHealthServer();
  await app.start();
  console.log(
    `[startup] slack-opencode-bridge running (opencode=${config.OPENCODE_BASE_URL}, db=${config.DB_PATH})`,
  );
}

function startHealthServer(): void {
  Bun.serve({
    port: config.HEALTH_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", uptime: process.uptime() }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  console.log(`[startup] health server on :${config.HEALTH_PORT}/health`);
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`[shutdown] received ${signal}`);
  clearInterval(cleanupInterval);
  await app.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch((error) => {
  console.error("Failed to start Slack app", error);
  process.exit(1);
});
