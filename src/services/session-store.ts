import Database from "better-sqlite3";

import { config } from "../config.js";
import type { SessionMapping, SessionStore } from "../types.js";

type SessionRow = {
  session_id: string;
  channel_id: string;
};

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  public constructor(dbPath: string = config.DB_PATH) {
    this.db = new Database(dbPath);
    this.db.prepare(
      `
        CREATE TABLE IF NOT EXISTS sessions (
          thread_ts TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `,
    ).run();
  }

  public setSession(threadTs: string, sessionId: string, channelId: string): void {
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
          SELECT session_id, channel_id
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
}
