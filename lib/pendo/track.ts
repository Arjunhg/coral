const PENDO_TRACK_URL = "https://data.pendo.io/data/track";
const PENDO_INTEGRATION_KEY = "560727b1-ea34-4081-a671-5551596d1c36";

export async function pendoTrackServer(
  event: string,
  properties: Record<string, unknown> = {},
  visitorId = "system",
  accountId = "system"
): Promise<void> {
  try {
    await fetch(PENDO_TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": PENDO_INTEGRATION_KEY,
      },
      body: JSON.stringify({
        type: "track",
        event,
        visitorId,
        accountId,
        timestamp: Date.now(),
        properties,
      }),
    });
  } catch (e) {
    console.error("[Pendo] Failed to send track event:", event, e);
  }
}
