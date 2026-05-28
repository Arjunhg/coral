import { NextResponse } from "next/server";

const TEMP_KEY_ENDPOINT = "https://mp.speechmatics.com/v1/api_keys?type=rt";
const TEMP_KEY_TTL_SECONDS = 300;

export async function POST() {
  const apiKey = process.env.SPEECHMATICS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "SPEECHMATICS_API_KEY is not set" },
      { status: 500 }
    );
  }

  const response = await fetch(TEMP_KEY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ttl: TEMP_KEY_TTL_SECONDS }),
  });

  if (!response.ok) {
    const details = await response.text();
    return NextResponse.json(
      {
        error: "Failed to create Speechmatics temporary key",
        details,
      },
      { status: response.status }
    );
  }

  const data = (await response.json()) as { key_value?: string };
  const jwt = data?.key_value;

  if (!jwt) {
    return NextResponse.json(
      { error: "Speechmatics response missing key_value" },
      { status: 502 }
    );
  }

  return NextResponse.json({ jwt });
}
