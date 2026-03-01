import { config } from "../config.js";
import type {
  ChatUpdateClient,
  OpenCodeEvent,
  StreamRenderer,
} from "../types.js";
import { formatDiff } from "./diff-formatter.js";
import { formatMessage } from "./formatter.js";
import { resolvePermission, subscribeEvents } from "./opencode-client.js";
import {
  type PermissionRequest,
  buildPermissionBlocks,
  buildPermissionResolvedBlocks,
} from "./permission-blocks.js";

type ActiveSession = {
  channel: string;
  messageTs: string;
  threadTs: string;
  latestText: string;
  latestTodoText: string | null;
  todoMessageTs: string | null;
  timer: ReturnType<typeof setTimeout> | null;
};

type PendingPermission = {
  permission: PermissionRequest;
  channel: string;
  messageTs: string;
  timer: ReturnType<typeof setTimeout>;
};

export class SlackStreamRenderer implements StreamRenderer {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private streamTask: Promise<void> | null = null;
  private running = false;

  public constructor(private readonly slackClient: ChatUpdateClient) {}

  public start(
    sessionId: string,
    channel: string,
    messageTs: string,
    threadTs: string,
  ): void {
    this.sessions.set(sessionId, {
      channel,
      messageTs,
      threadTs,
      latestText: "",
      latestTodoText: null,
      todoMessageTs: null,
      timer: null,
    });
    void this.safeAddReaction(sessionId, "blue_circle");
    this.ensureStreamLoop();
  }

  public stop(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return;
    }

    if (existing.timer) {
      clearTimeout(existing.timer);
    }

    for (const [permissionId, pending] of this.pendingPermissions.entries()) {
      if (pending.permission.sessionID !== sessionId) {
        continue;
      }
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(permissionId);
    }

    this.sessions.delete(sessionId);
    void this.safeRemoveReaction(
      sessionId,
      existing.channel,
      existing.threadTs,
      "blue_circle",
    );
  }

  public cancelPermissionTimeout(permissionId: string): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingPermissions.delete(permissionId);
  }

  private ensureStreamLoop(): void {
    if (this.streamTask) {
      return;
    }

    this.running = true;
    this.streamTask = this.consumeStream().finally(() => {
      this.streamTask = null;
      this.running = false;
    });
  }

  private async consumeStream(): Promise<void> {
    try {
      const stream = await subscribeEvents();
      for await (const event of stream) {
        if (!this.running) {
          break;
        }
        await this.handleEvent(event);
      }
    } catch (error) {
      console.error("Failed to consume OpenCode event stream", error);
    }
  }

  private async handleEvent(event: OpenCodeEvent): Promise<void> {
    if (event.type === "message.part.updated") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      const part = this.readPart(event);
      if (!part) {
        return;
      }

      if (part.type !== "text" && part.type !== "diff") {
        return;
      }

      session.latestText =
        part.type === "diff" ? formatDiff(part.text) : part.text;
      this.scheduleFlush(sessionId);
      return;
    }

    if (event.type === "todo.updated") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      const todoItems = this.readTodos(event);
      if (todoItems.length === 0) {
        return;
      }

      session.latestTodoText = this.formatTodoChecklist(todoItems);
      this.scheduleFlush(sessionId);
      return;
    }

    if (event.type === "session.idle") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }
      await this.safeRemoveReaction(
        sessionId,
        undefined,
        undefined,
        "blue_circle",
      );
      await this.safeAddReaction(sessionId, "white_check_mark");
      await this.flush(sessionId);
      this.stop(sessionId);
      return;
    }

    if (event.type === "session.error") {
      const sessionId = this.readSessionId(event);
      if (!sessionId) {
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      const errorMessage =
        this.readErrorMessage(event) ?? "Unknown OpenCode session error";
      await this.safeRemoveReaction(
        sessionId,
        session.channel,
        session.threadTs,
        "blue_circle",
      );
      await this.safeAddReaction(sessionId, "x");
      await this.slackClient.chat.postMessage({
        channel: session.channel,
        thread_ts: session.threadTs,
        text: `❌ Session error: ${errorMessage}`,
      });

      this.stop(sessionId);
      return;
    }

    if (event.type === "permission.updated") {
      const permission = this.readPermission(event);
      if (!permission) {
        return;
      }

      const session = this.sessions.get(permission.sessionID);
      if (!session) {
        return;
      }

      const blocks = buildPermissionBlocks(permission);
      const text = formatMessage(`Permission requested: ${permission.title}`);
      const response = await this.slackClient.chat.postMessage({
        channel: session.channel,
        thread_ts: session.threadTs,
        text,
        blocks,
      });

      const postedTs =
        response && typeof response === "object"
          ? Reflect.get(response, "ts")
          : undefined;
      if (typeof postedTs !== "string" || postedTs.length === 0) {
        return;
      }

      this.cancelPermissionTimeout(permission.id);
      const timer = setTimeout(() => {
        void this.handlePermissionTimeout(permission.id);
      }, config.PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(permission.id, {
        permission,
        channel: session.channel,
        messageTs: postedTs,
        timer,
      });
    }
  }

  private async handlePermissionTimeout(permissionId: string): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      return;
    }

    this.pendingPermissions.delete(permissionId);

    try {
      await resolvePermission(
        pending.permission.sessionID,
        permissionId,
        "reject",
      );
    } catch (error) {
      console.error("Failed to auto-deny permission", error);
      return;
    }

    const blocks = buildPermissionResolvedBlocks(
      pending.permission,
      "reject",
      "auto-deny timeout",
    );

    try {
      await this.slackClient.chat.update({
        channel: pending.channel,
        ts: pending.messageTs,
        text: `Permission ${permissionId} auto-denied after 5 minutes`,
        blocks,
      });
    } catch (error) {
      console.error("Failed to update auto-denied permission message", error);
    }
  }

  private async safeAddReaction(
    sessionId: string,
    reaction: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    await this.safeReactionCall(
      "add",
      session.channel,
      session.threadTs,
      reaction,
    );
  }

  private async safeRemoveReaction(
    sessionId: string,
    channel: string | undefined,
    threadTs: string | undefined,
    reaction: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const reactionChannel = channel ?? session?.channel;
    const reactionThreadTs = threadTs ?? session?.threadTs;
    if (!reactionChannel || !reactionThreadTs) {
      return;
    }
    await this.safeReactionCall(
      "remove",
      reactionChannel,
      reactionThreadTs,
      reaction,
    );
  }

  private async safeReactionCall(
    mode: "add" | "remove",
    channel: string,
    timestamp: string,
    name: string,
  ): Promise<void> {
    try {
      if (mode === "add") {
        await this.slackClient.reactions.add({ channel, timestamp, name });
        return;
      }

      await this.slackClient.reactions.remove({ channel, timestamp, name });
    } catch (error) {
      console.warn(`[stream] failed to ${mode} reaction ${name}`, error);
    }
  }

  private scheduleFlush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
    }

    session.timer = setTimeout(() => {
      session.timer = null;
      void this.flush(sessionId);
    }, config.STREAM_DEBOUNCE_MS);
  }

  private async flush(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const text = formatMessage(session.latestText || "\u2026");
    await this.slackClient.chat.update({
      channel: session.channel,
      ts: session.messageTs,
      text,
    });

    await this.flushTodo(session);
  }

  private readSessionId(event: OpenCodeEvent): string | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const value = properties.sessionID;
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    return value;
  }

  private async flushTodo(session: ActiveSession): Promise<void> {
    if (!session.latestTodoText) {
      return;
    }

    if (session.todoMessageTs) {
      await this.slackClient.chat.update({
        channel: session.channel,
        ts: session.todoMessageTs,
        text: session.latestTodoText,
      });
      return;
    }

    const response = await this.slackClient.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: session.latestTodoText,
    });

    const postedTs =
      response && typeof response === "object"
        ? Reflect.get(response, "ts")
        : undefined;
    if (typeof postedTs === "string" && postedTs.length > 0) {
      session.todoMessageTs = postedTs;
    }
  }

  private readPart(
    event: OpenCodeEvent,
  ): { type: string; text: string } | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const part = properties.part;
    if (!part || typeof part !== "object") {
      return null;
    }

    const partType = Reflect.get(part, "type");
    const partText = Reflect.get(part, "text");
    const partDiff = Reflect.get(part, "diff");
    const textValue =
      typeof partText === "string"
        ? partText
        : typeof partDiff === "string"
          ? partDiff
          : null;

    if (typeof partType !== "string" || textValue === null) {
      return null;
    }

    return { type: partType, text: textValue };
  }

  private readTodos(
    event: OpenCodeEvent,
  ): Array<{ content: string; status: string }> {
    const properties = event.properties;
    if (!properties) {
      return [];
    }

    const todos = Reflect.get(properties, "todos");
    if (!Array.isArray(todos)) {
      return [];
    }

    const items: Array<{ content: string; status: string }> = [];
    for (const todo of todos) {
      if (!todo || typeof todo !== "object") {
        continue;
      }

      const content = Reflect.get(todo, "content");
      const status = Reflect.get(todo, "status");
      if (typeof content !== "string" || typeof status !== "string") {
        continue;
      }

      items.push({ content, status });
    }

    return items;
  }

  private formatTodoChecklist(
    todos: Array<{ content: string; status: string }>,
  ): string {
    const lines = todos.map((todo) => {
      const status = todo.status.toLowerCase();
      if (status === "done" || status === "completed") {
        return `☑️ ${todo.content}`;
      }

      if (
        status === "in_progress" ||
        status === "in-progress" ||
        status === "doing"
      ) {
        return `🔄 ${todo.content}`;
      }

      return `⬜ ${todo.content}`;
    });

    return lines.join("\n");
  }

  private readErrorMessage(event: OpenCodeEvent): string | null {
    const properties = event.properties;
    if (!properties) {
      return null;
    }

    const value = properties.error;
    return typeof value === "string" ? value : null;
  }

  private readPermission(event: OpenCodeEvent): PermissionRequest | null {
    const properties = event.properties;
    if (!properties || typeof properties !== "object") {
      return null;
    }

    const id = Reflect.get(properties, "id");
    const type = Reflect.get(properties, "type");
    const pattern = Reflect.get(properties, "pattern");
    const sessionID = Reflect.get(properties, "sessionID");
    const title = Reflect.get(properties, "title");
    const metadataValue = Reflect.get(properties, "metadata");
    const timeValue = Reflect.get(properties, "time");

    if (
      typeof id !== "string" ||
      typeof type !== "string" ||
      typeof sessionID !== "string" ||
      typeof title !== "string"
    ) {
      return null;
    }

    const metadata: Record<string, unknown> =
      metadataValue && typeof metadataValue === "object"
        ? (metadataValue as Record<string, unknown>)
        : {};

    let created = Date.now();
    if (timeValue && typeof timeValue === "object") {
      const createdValue = Reflect.get(timeValue, "created");
      if (typeof createdValue === "number" && Number.isFinite(createdValue)) {
        created = createdValue;
      }
    }

    const normalizedPattern =
      typeof pattern === "string" || Array.isArray(pattern)
        ? pattern
        : undefined;

    return {
      id,
      type,
      pattern: normalizedPattern,
      sessionID,
      title,
      metadata,
      time: { created },
    };
  }
}
