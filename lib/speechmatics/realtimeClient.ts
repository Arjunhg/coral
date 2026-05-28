import { RealtimeClient } from "@speechmatics/real-time-client";

const DEFAULT_RT_URL = "wss://eu2.rt.speechmatics.com/v2";

export function createSpeechmaticsClient() {
  return new RealtimeClient({
    url: process.env.NEXT_PUBLIC_SPEECHMATICS_RT_URL?.trim() || DEFAULT_RT_URL,
    appId: "scriptless-voice",
    connectionTimeout: 15000,
  });
}

