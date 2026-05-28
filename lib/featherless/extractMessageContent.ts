/** Normalize OpenAI-compatible chat message content to plain text. */
export function extractMessageContent(
  content: string | Array<{ type?: string; text?: string }> | null | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return String(content).trim();

  return content
    .map((part) => (part?.type === "text" && part.text ? part.text : ""))
    .join("\n")
    .trim();
}
