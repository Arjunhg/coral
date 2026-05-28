function buildSummaryMessage(passed: number, failed: number, total: number) {
  return `Test run completed. ${passed} passed, ${failed} failed, out of ${total} total tests.`;
}

export async function speakTestSummary(
  passed: number,
  failed: number,
  total: number
): Promise<void> {
  if (typeof window === "undefined") return;

  const message = buildSummaryMessage(passed, failed, total);

  try {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.lang = "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  } catch {
    // No-op. Voice readback should never break test execution UX.
  }
}

