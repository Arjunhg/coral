export type VoiceFilterStatus = "all" | "passing" | "failing";

export type VoiceCommand =
  | { type: "RUN_TESTS"; scope: "all" | "failed" | "selected" }
  | { type: "FILTER_RESULTS"; status: VoiceFilterStatus }
  | { type: "CONNECT_REPO" }
  | { type: "QUERY_DATA"; text: string }
  | { type: "UNKNOWN"; raw: string };

const QUERY_TRIGGERS = [
  "show",
  "list",
  "find",
  "get",
  "tell",
  "give",
  "ask",
  "query",
  "search",
  "look",
  "fetch",
  "what",
  "which",
  "how",
  "where",
  "why",
];

const DATA_NOUNS = [
  "issue",
  "issues",
  "ticket",
  "tickets",
  "commit",
  "commits",
  "pr",
  "prs",
  "pull",
  "request",
  "requests",
  "error",
  "errors",
  "bug",
  "bugs",
  "incident",
  "sentry",
  "linear",
  "github",
  "slack",
  "stripe",
  "datadog",
  "test",
  "tests",
  "failing",
  "passing",
  "failure",
  "user",
  "users",
  "customer",
  "customers",
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "please",
  "can",
  "could",
  "would",
  "you",
  "me",
  "to",
  "for",
  "of",
  "my",
  "your",
  "this",
  "that",
  "now",
  "just",
  "kindly",
  "hey",
  "hi",
]);

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 2 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((t) => stemToken(t))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function hasAny(tokens: Set<string>, words: string[]): boolean {
  return words.some((w) => tokens.has(stemToken(w)));
}

function hasAll(tokens: Set<string>, words: string[]): boolean {
  return words.every((w) => tokens.has(stemToken(w)));
}

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = transcript.trim();
  if (!raw) {
    return { type: "UNKNOWN", raw };
  }

  const normalized = normalizeText(raw);
  const tokenSet = new Set(tokenize(raw));
  if (tokenSet.size === 0) {
    return { type: "UNKNOWN", raw };
  }

  const hasRepoWord = hasAny(tokenSet, [
    "repo",
    "repository",
    "github",
    "project",
    "codebase",
  ]);
  const hasConnectVerb = hasAny(tokenSet, [
    "connect",
    "add",
    "link",
    "attach",
    "import",
    "setup",
    "set",
    "configure",
    "open",
  ]);

  const hasTestWord = hasAny(tokenSet, [
    "test",
    "case",
    "suite",
    "check",
    "spec",
    "scenario",
  ]);
  const hasRunVerb = hasAny(tokenSet, [
    "run",
    "rerun",
    "retry",
    "start",
    "execute",
    "launch",
    "trigger",
  ]);

  const hasFailedWord = hasAny(tokenSet, ["failed", "failing", "broken", "failure"]);
  const hasSelectedWord = hasAny(tokenSet, ["selected", "checked", "marked", "picked", "highlighted"]);
  const hasAllWord = hasAny(tokenSet, ["all", "every", "entire"]);

  const hasFilterVerb = hasAny(tokenSet, ["show", "filter", "display", "view", "see", "only"]);
  const hasPassingWord = hasAny(tokenSet, ["pass", "passed", "passing"]);

  if ((hasRepoWord && hasConnectVerb) || /connect .*repo/.test(normalized)) {
    return { type: "CONNECT_REPO" };
  }

  if (hasRunVerb && hasTestWord && hasFailedWord) {
    return { type: "RUN_TESTS", scope: "failed" };
  }

  if (hasRunVerb && hasTestWord && hasSelectedWord) {
    return { type: "RUN_TESTS", scope: "selected" };
  }

  if (hasRunVerb && hasTestWord) {
    return { type: "RUN_TESTS", scope: "all" };
  }

  const hasQueryTrigger = hasAny(tokenSet, QUERY_TRIGGERS);
  const hasDataNoun = hasAny(tokenSet, DATA_NOUNS);
  const isQuestionForm = /^(what|which|how|where|why|who|when)/.test(normalized);
  const hasJoinCue = /\b(with|and|that have|including|along with)\b/.test(normalized);

  if (
    (isQuestionForm && hasDataNoun) ||
    (hasQueryTrigger && hasDataNoun && !hasRunVerb) ||
    (hasDataNoun && hasJoinCue)
  ) {
    const cleaned = raw
      .replace(/^(hey|hi|hello|please|scriptless|coral)[,\s]+/i, "")
      .replace(/^(can you|could you|would you|will you)\s+/i, "")
      .trim();
    return { type: "QUERY_DATA", text: cleaned };
  }

  if (hasFilterVerb && hasFailedWord) {
    return { type: "FILTER_RESULTS", status: "failing" };
  }

  if (hasFilterVerb && hasPassingWord) {
    return { type: "FILTER_RESULTS", status: "passing" };
  }

  if (
    (hasFilterVerb && hasAllWord && hasTestWord) ||
    hasAll(tokenSet, ["clear", "filter"]) ||
    hasAll(tokenSet, ["remove", "filter"]) ||
    /show all/.test(normalized)
  ) {
    return { type: "FILTER_RESULTS", status: "all" };
  }

  return { type: "UNKNOWN", raw };
}
