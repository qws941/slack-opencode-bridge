# slack-opencode-bridge

Bidirectional Slack ↔ OpenCode AI bridge.

## Overview

Socket Mode Bolt.js bot that bridges Slack @mentions to OpenCode AI sessions with streaming output, interactive permissions, error alerting, and cost tracking.

## Features

- @mention → AI session with streaming response (1.5s debounced chat.update)
- Thread-based multi-turn conversations
- Permission requests via Block Kit (Approve / Always Allow / Deny) with 5-min auto-deny timeout
- GlitchTip webhook alerts with severity-based routing (critical→DM+channel)
- 🔧 wrench reaction on alerts → auto-triage via OpenCode session
- `/oc` slash command: `status`, `sessions`, `cost`, `help`
- Token/cost tracking per session with aggregate dashboard
- Emoji status lifecycle (🔵→✅/❌)
- SQLite session persistence with auto-cleanup
- Docker deployment with health checks

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Slack     │────▶│  Bolt.js    │────▶│   Stream    │────▶│  OpenCode   │
│  (Socket)   │     │ (Socket)    │     │  Renderer   │     │    SDK      │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      ▲                                                                 │
      │                                                                 ▼
      │                                                          ┌─────────────┐
      │                                                          │opencode-    │
      │                                                          │serve        │
      │                                                          └─────────────┘
      │
      │    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
      └────│  GlitchTip  │────▶│   Health    │────▶│   Slack     │
            │  Webhooks   │     │   Server    │     │   (alerts)  │
            └─────────────┘     └─────────────┘     └─────────────┘

Permission flow:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Block Kit  │────▶│   Action    │────▶│    SDK      │────▶│  OpenCode   │
│   (modal)   │     │   Handler   │     │   (call)    │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

## Prerequisites

- Bun ≥1.0
- OpenCode server running (default: http://localhost:4096)
- Slack App with Socket Mode enabled
- Slack App Event Subscriptions: `app_mention`, `message.im`
- Slack App Interactivity enabled

## Quick Start

```bash
git clone https://github.com/qws941/slack-opencode-bridge.git
cd slack-opencode-bridge
bun install
cp .env.example .env
# Configure SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, OPENCODE_BASE_URL
bun run dev
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | - | Bot User OAuth Token (xoxb-...) |
| `SLACK_APP_TOKEN` | Yes | - | App-Level Token (xapp-...) |
| `SLACK_SIGNING_SECRET` | Yes | - | Slack signing secret |
| `OPENCODE_BASE_URL` | No | http://localhost:4096 | OpenCode server URL |
| `NOTIFICATION_CHANNEL` | No | - | Channel ID for alerts |
| `ALERT_DM_USER_ID` | No | - | User ID for alert DMs |
| `GLITCHTIP_WEBHOOK_SECRET` | No | - | GlitchTip webhook secret |
| `DB_PATH` | No | ./data/sessions.db | SQLite database path |
| `STREAM_DEBOUNCE_MS` | No | 1500 | Stream update debounce (ms) |
| `SESSION_TIMEOUT_SECONDS` | No | 3600 | Session expiry time (s) |
| `CLEANUP_INTERVAL_MS` | No | 900000 | Cleanup interval (ms) |
| `PERMISSION_TIMEOUT_MS` | No | 300000 | Permission request timeout (ms) |
| `HEALTH_PORT` | No | 3000 | Health check server port |
| `LOG_LEVEL` | No | info | Log level (debug/info/warn/error) |

## Slack App Setup

1. Create a new Slack App at https://api.slack.com/apps
2. Enable **Socket Mode** in the app settings
3. Add **Bot Token Scopes**:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `commands`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `im:write`
   - `reactions:read`
   - `reactions:write`
4. Enable **Event Subscriptions**:
   - Subscribe to `app_mention` event
   - Subscribe to `message.im` event
5. Enable **Interactivity**
6. Create **Slash Command** `/oc` (no Request URL needed — Socket Mode handles routing)
7. Install app to workspace

## Docker

```bash
docker compose up -d
```

Health check endpoint: `http://localhost:3000/health`

## Development

```bash
bun run dev      # Watch mode
bun run typecheck
bun run lint
```

## Project Structure

```
src/
├── app.ts              # Bolt.js app factory
├── config.ts           # Configuration loader
├── index.ts            # Entry point, health server
├── types.ts            # TypeScript interfaces
├── handlers/
│   ├── action.ts       # Block Kit action handlers (permissions)
│   ├── command.ts      # /oc slash command handler
│   ├── mention.ts      # @mention event handler
│   ├── message.ts      # Direct message handler
│   ├── reaction.ts     # Reaction handlers (auto-triage)
│   └── webhook.ts      # GlitchTip webhook handler
├── services/
│   ├── dashboard-blocks.ts  # Cost dashboard Block Kit
│   ├── diff-formatter.ts   # Diff formatting utilities
│   ├── formatter.ts        # Message formatting
│   ├── glitchtip-blocks.ts # Alert Block Kit templates
│   ├── opencode-client.ts  # OpenCode API client
│   ├── permission-blocks.ts # Permission request UI
│   ├── session-store.ts     # SQLite session persistence
│   └── stream-renderer.ts  # Streaming response handler
```

## License

MIT
