import {
  openai,
  NVIDIA_TEXT_MODEL,
} from "./client";
import { TEST_GENERATION_SYSTEM_PROMPT } from "./prompts/testGeneration";
import { TEST_CASE_TOOL_DEFINITION } from "./tools/testCaseTool";

export type GeneratedTestCase = {
  title: string;
  description: string;
  type: string;
  priority: string;
  targetRoute: string;
  targetFiles: string[];
  expectedResult: string;
};

type ParsedTestCases = {
  testCases?: GeneratedTestCase[];
};

function extractJsonCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

function tryParseTestCases(raw: string): ParsedTestCases | null {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as ParsedTestCases;
  } catch {
    return null;
  }
}

async function requestJsonFallback(
  messages: { role: "system" | "user"; content: string }[]
): Promise<ParsedTestCases | null> {
  const response = await openai.chat.completions.create({
    model: NVIDIA_TEXT_MODEL,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "Return ONLY a valid JSON object with a testCases array. Do not use markdown.",
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  return tryParseTestCases(content);
}

export async function generateTestCases(
  fileTree: string,
  sourceCode: string,
  repoMeta?: { owner: string; repo: string; branch: string }
): Promise<GeneratedTestCase[]> {
  const repoHeader = repoMeta
    ? `Repository:\nOwner: ${repoMeta.owner}\nRepo: ${repoMeta.repo}\nBranch: ${repoMeta.branch}\n\n`
    : "";

  const messages = [
    { role: "system", content: TEST_GENERATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${repoHeader}File tree:\n${fileTree}\n\nSource:\n${sourceCode}`,
    },
  ] as const;

  const stream = await openai.chat.completions.create({
    model: NVIDIA_TEXT_MODEL,
    messages: [...messages],
    tools: [TEST_CASE_TOOL_DEFINITION],
    tool_choice: {
      type: "function",
      function: { name: "submit_test_cases" },
    },
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 3000,
    stream: true
  });

  let content = "";
  let toolArguments = "";

  for await (const chunk of stream){
    const delta = chunk.choices[0]?.delta;

    if(delta?.content){
      content += delta.content;
    }

    if(delta?.tool_calls){
      for(const toolCall of delta.tool_calls){
        if(toolCall.function?.arguments){
          toolArguments += toolCall.function.arguments;
        }
      }
    }
  }

  let parsed: ParsedTestCases | null = null;

  if(toolArguments.trim()){
    parsed = tryParseTestCases(toolArguments);
  }

  if(!parsed && content.trim()){
    parsed = tryParseTestCases(content);
  }

  if (!parsed) {
    parsed = await requestJsonFallback([...messages]);
  }

  if (!parsed) {
    throw new Error("Test generation failed — please try again");
  }

  const testCases = parsed.testCases ?? [];
  if (!testCases.length) {
    throw new Error("Test generation failed — please try again");
  }

  return testCases;
}
