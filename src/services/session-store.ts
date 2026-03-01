import Database from "better-sqlite3";

import { config } from "../config.js";
import type {
  SessionCostSummary,
  SessionMapping,
  SessionStore,
} from "../types.js";

type SessionRow = {
  thread_ts: string;
  session_id: string;
  channel_id: string;
  created_at: number;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
};

type TableInfoRow = {
  name: string;
};

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  public constructor(dbPath: string = config.DB_PATH) {
    this.db = new Database(dbPath);
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS sessions (
          thread_ts TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `,
      )
      .run();

    this.ensureCostColumns();
  }

  public setSession(
    threadTs: string,
    sessionId: string,
    channelId: string,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO sessions (thread_ts, session_id, channel_id)
          VALUES (?, ?, ?)
          ON CONFLICT(thread_ts)
          DO UPDATE SET session_id = excluded.session_id, channel_id = excluded.channel_id
        `,
      )
      .run(threadTs, sessionId, channelId);
  }

  public getSession(threadTs: string): SessionMapping | null {
    const row = this.db
      .prepare(
        `
          SELECT session_id, channel_id, total_cost, input_tokens, output_tokens
          FROM sessions
          WHERE thread_ts = ?
        `,
      )
      .get(threadTs) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      channelId: row.channel_id,
      totalCost: row.total_cost,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    };
  }

  public updateCost(
    threadTs: string,
    cost: number,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.db
      .prepare(
        `
          UPDATE sessions
          SET
            total_cost = total_cost + ?,
            input_tokens = input_tokens + ?,
            output_tokens = output_tokens + ?
          WHERE thread_ts = ?
        `,
      )
      .run(cost, inputTokens, outputTokens, threadTs);
  }

  public getCostSummary(): SessionCostSummary {
    const row = this.db
      .prepare(
        `
          SELECT
            COALESCE(SUM(total_cost), 0) AS total_cost,
            COALESCE(SUM(input_tokens), 0) AS total_input,
            COALESCE(SUM(output_tokens), 0) AS total_output,
            COUNT(*) AS session_count
          FROM sessions
        `,
      )
      .get() as
      | {
          total_cost: number;
          total_input: number;
          total_output: number;
          session_count: number;
        }
      | undefined;

    if (!row) {
      return {
        totalCost: 0,
        totalInput: 0,
        totalOutput: 0,
        sessionCount: 0,
      };
    }

    return {
      totalCost: row.total_cost,
      totalInput: row.total_input,
      totalOutput: row.total_output,
      sessionCount: row.session_count,
    };
  }

  public deleteSession(threadTs: string): void {
    this.db
      .prepare(
        `
          DELETE FROM sessions
          WHERE thread_ts = ?
        `,
      )
      .run(threadTs);
  }

  public cleanupExpiredSessions(maxAgeSeconds: number): number {
    const result = this.db
      .prepare(
        `
          DELETE FROM sessions
          WHERE created_at < unixepoch() - ?
        `,
      )
      .run(maxAgeSeconds);

    return Number(result.changes);
  }

  public getAllSessions(): Array<{
    threadTs: string;
    sessionId: string;
    channelId: string;
    createdAt: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    const rows = this.db
      .prepare(
        `
          SELECT
            thread_ts,
            session_id,
            channel_id,
            created_at,
            total_cost,
            input_tokens,
            output_tokens
          FROM sessions
          ORDER BY created_at DESC
        `,
      )
      .all() as SessionRow[];

    return rows.map((row) => ({
      threadTs: row.thread_ts,
      sessionId: row.session_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
      totalCost: row.total_cost,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    }));
  }

  private ensureCostColumns(): void {
    if (!this.hasColumn("total_cost")) {
      this.db
        .prepare(
          "ALTER TABLE sessions ADD COLUMN total_cost REAL NOT NULL DEFAULT 0",
        )
        .run();
    }

    if (!this.hasColumn("input_tokens")) {
      this.db
        .prepare(
          "ALTER TABLE sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
        )
        .run();
    }

    if (!this.hasColumn("output_tokens")) {
      this.db
        .prepare(
          "ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
        )
        .run();
    }
  }

  private hasColumn(columnName: string): boolean {
    const rows = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as TableInfoRow[];

    return rows.some((row) => row.name === columnName);
  }
}
