import { featherlessClient, getVisionModelChain } from "./client";
import { extractMessageContent } from "./extractMessageContent";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function truncateDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl;
  const header = dataUrl.slice(0, comma + 1);
  const base64 = dataUrl.slice(comma + 1);
  const maxBase64Len = Math.floor((MAX_IMAGE_BYTES * 4) / 3);
  if (base64.length <= maxBase64Len) return dataUrl;
  return header + base64.slice(0, maxBase64Len);
}

async function requestVisionAnalysis(
  model: string,
  screenshotUrl: string,
  testDescription: string
): Promise<string> {
  const response = await featherlessClient.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a QA engineer analyzing a browser test failure screenshot.

Test case: ${testDescription}

Describe what is visible on the page, what likely went wrong, and suggest concrete next steps to fix the test or the application. Be concise (3–5 sentences).`,
          },
          {
            type: "image_url",
            image_url: { url: truncateDataUrl(screenshotUrl) },
          },
        ],
      },
    ],
    max_tokens: 512,
  });

  const choice = response.choices[0];
  const text = extractMessageContent(choice?.message?.content);

  if (!text) {
    const reason = choice?.finish_reason ?? "unknown";
    throw new Error(
      `Vision model ${model} returned empty content (finish_reason: ${reason})`
    );
  }

  return text;
}

export async function analyzeScreenshot(
  screenshotUrl: string,
  testDescription: string
): Promise<string> {
  const uniqueModels = getVisionModelChain();

  let lastError: Error | null = null;

  for (const model of uniqueModels) {
    try {
      return await requestVisionAnalysis(model, screenshotUrl, testDescription);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("Featherless vision model returned no analysis");
}
