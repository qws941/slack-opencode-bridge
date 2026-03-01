import { splitMessage } from "./formatter.js";

const EMPTY_DIFF_PLACEHOLDER = "...";

function wrapDiffCodeBlock(content: string): string {
  return `\`\`\`diff\n${content}\n\`\`\``;
}

export function formatDiff(diff: string): string {
  const source = diff.length > 0 ? diff : EMPTY_DIFF_PLACEHOLDER;
  const chunks = splitMessage(source);

  if (chunks.length === 1) {
    return wrapDiffCodeBlock(chunks[0]);
  }

  return chunks.map((chunk) => wrapDiffCodeBlock(chunk)).join("\n\n");
}
