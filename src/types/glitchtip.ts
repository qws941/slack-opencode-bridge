export interface GlitchTipIssueWebhook {
  action: "created" | "resolved" | "assigned" | "archived" | "unresolved";
  installation: { uuid: string };
  data: {
    issue: {
      id: string;
      short_id: string;
      title: string;
      culprit: string;
      level: "fatal" | "error" | "warning" | "info" | "debug";
      status: "unresolved" | "resolved" | "ignored";
      platform: string;
      count: string;
      userCount: number;
      web_url: string;
      permalink: string;
      firstSeen: string;
      lastSeen: string;
      project: { id: string; name: string; slug: string; platform: string };
      metadata: {
        title: string;
        type?: string;
        value?: string;
        filename?: string;
      };
      priority?: "high" | "medium" | "low";
      issueType?: string;
      issueCategory?: "error" | "outage" | "feedback";
      assignedTo?: { type: string; id: string; name: string } | null;
    };
  };
  actor?: { type: string; id: string; name: string };
}

export interface GlitchTipErrorWebhook {
  action: "created";
  installation: { uuid: string };
  data: {
    error: {
      event_id: string;
      title: string;
      culprit: string;
      level: string;
      platform: string;
      datetime: string;
      issue_id: string;
      web_url: string;
      metadata: { filename?: string; type: string; value: string };
      exception?: {
        values: Array<{
          type: string;
          value: string;
          mechanism?: { type: string; handled: boolean };
          stacktrace?: {
            frames: Array<{
              abs_path: string;
              filename: string;
              function?: string;
              lineno: number;
              colno?: number;
              in_app: boolean;
              context_line?: string;
              pre_context?: string[];
              post_context?: string[];
            }>;
          };
        }>;
      };
      contexts?: Record<
        string,
        { name: string; type: string; version?: string }
      >;
      tags?: Array<[string, string]>;
      user?: { ip_address?: string; email?: string; id?: string };
      request?: { url: string; method?: string };
    };
  };
}

export type GlitchTipWebhook = GlitchTipIssueWebhook | GlitchTipErrorWebhook;

export type NotificationTier = "critical" | "important" | "info";
