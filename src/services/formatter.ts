const SLACK_CHAR_LIMIT = 3500;
const CONTINUATION_SUFFIX = "\n\n_...continued in thread_";
const CONTINUATION_PREFIX = "_...continued_\n\n";

/**
 * Convert common Markdown syntax to Slack mrkdwn.
 * Handles: code fences (strip lang tag), bold, italic, links, headings, unordered lists.
 */
export function formatMarkdown(markdown: string): string {
  let output = markdown;

  // Code fence: strip language identifier but keep triple backticks
  output = output.replace(/```[a-zA-Z0-9_-]+\n([\s\S]*?)```/g, "```$1```");
  // Bold: **text** → *text*
  output = output.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Italic: *text* → _text_ (only when not inside bold)
  output = output.replace(
    /(^|\W)\*(?!\s)([^*\n]+?)(?!\s)\*(?=\W|$)/g,
    "$1_$2_",
  );
  // Links: [label](url) → <url|label>
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>");
  // Headings: # text → *text*
  output = output.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  // Unordered list dash → bullet
  output = output.replace(/^\s*-\s+/gm, "• ");

  return output;
}

/**
 * Format and truncate a single message for Slack (used during streaming updates).
 */
export function formatMessage(markdown: string): string {
  return truncateMessage(formatMarkdown(markdown), SLACK_CHAR_LIMIT);
}

/**
 * Split a large formatted message into chunks that fit Slack's character limit.
 * First chunk is capped to leave room for continuation suffix.
 * Subsequent chunks include a continuation prefix.
 * Splits at natural boundaries: double newline, single newline, space.
 */
export function splitMessage(markdown: string): string[] {
  const formatted = formatMarkdown(markdown);

  if (formatted.length <= SLACK_CHAR_LIMIT) {
    return [formatted];
  }

  const chunks: string[] = [];
  let remaining = formatted;

  while (remaining.length > 0) {
    const isFirst = chunks.length === 0;
    const prefix = isFirst ? "" : CONTINUATION_PREFIX;
    const suffix =
      remaining.length > SLACK_CHAR_LIMIT ? CONTINUATION_SUFFIX : "";
    const budget = SLACK_CHAR_LIMIT - prefix.length - suffix.length;

    if (remaining.length <= SLACK_CHAR_LIMIT - prefix.length) {
      chunks.push(`${prefix}${remaining}`);
      break;
    }

    const breakpoint = findBreakpoint(remaining, budget);
    const chunk = remaining.slice(0, breakpoint).trimEnd();
    remaining = remaining.slice(breakpoint).trimStart();

    chunks.push(`${prefix}${chunk}${suffix}`);
  }

  return chunks;
}

function truncateMessage(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const suffix = "... _(truncated)_";
  const sliced = text.slice(0, Math.max(0, limit - suffix.length));
  return `${sliced}${suffix}`;
}

/**
 * Find the best breakpoint within budget.
 * Priority: paragraph break (

), line break (
), word boundary (space).
 * Falls back to hard cut at budget limit.
 */
function findBreakpoint(text: string, budget: number): number {
  const region = text.slice(0, budget);

  // Try paragraph break (double newline) — search from end
  const paraBreak = region.lastIndexOf("\n\n");
  if (paraBreak > budget * 0.3) {
    return paraBreak + 2;
  }

  // Try line break
  const lineBreak = region.lastIndexOf("\n");
  if (lineBreak > budget * 0.3) {
    return lineBreak + 1;
  }

  // Try word boundary (space)
  const spaceBreak = region.lastIndexOf(" ");
  if (spaceBreak > budget * 0.3) {
    return spaceBreak + 1;
  }

  // Hard cut
  return budget;
}
