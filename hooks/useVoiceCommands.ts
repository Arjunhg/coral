"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ReceiveMessageEvent,
  RealtimeClient,
} from "@speechmatics/real-time-client";
import { createSpeechmaticsClient } from "@/lib/speechmatics/realtimeClient";
import {
  parseVoiceCommand,
  VoiceCommand,
} from "@/lib/speechmatics/commandParser";

export type VoiceStatus = "idle" | "listening" | "processing" | "error";

type UseVoiceCommandsOptions = {
  onCommand: (command: VoiceCommand) => void;
  language?: string;
  debug?: boolean;
};

const IDLE_FINALIZE_MS = 1200;
const POST_PUNCTUATION_FINALIZE_MS = 450;
const MAX_UTTERANCE_MS = 6000;
const CONTINUATION_RETRY_MS = 900;

function float32ToInt16PCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

export function useVoiceCommands({
  onCommand,
  language = "en",
  debug = false,
}: UseVoiceCommandsOptions) {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const lastAudioLogAtRef = useRef(0);
  const lastAudioAckAtRef = useRef(0);
  const transcriptBufferRef = useRef("");
  const transcriptTimerRef = useRef<number | null>(null);
  const utteranceStartedAtRef = useRef<number | null>(null);
  const lastTranscriptAtRef = useRef<number | null>(null);

  const clearTranscriptBuffer = useCallback(() => {
    transcriptBufferRef.current = "";
    utteranceStartedAtRef.current = null;
    lastTranscriptAtRef.current = null;
  }, []);

  const getWordCount = useCallback((input: string) => {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean).length;
  }, []);

  const teardownAudio = useCallback(async () => {
    processorNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (transcriptTimerRef.current) {
      window.clearTimeout(transcriptTimerRef.current);
      transcriptTimerRef.current = null;
    }
    clearTranscriptBuffer();
    await teardownAudio();

    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      await client.stopRecognition({ noTimeout: true }).catch(() => {});
    }

    setIsListening(false);
    setStatus("idle");
  }, [clearTranscriptBuffer, teardownAudio]);

  const finalizeTranscript = useCallback(
    (force: boolean) => {
      const finalTranscript = transcriptBufferRef.current.trim();
      if (!finalTranscript) {
        setStatus("listening");
        clearTranscriptBuffer();
        return;
      }

      if (debug) {
        console.log("[VOICE] Final transcript:", finalTranscript);
      }

      const parsed = parseVoiceCommand(finalTranscript);
      if (parsed.type !== "UNKNOWN") {
        onCommand(parsed);
        clearTranscriptBuffer();
        setStatus("listening");
        return;
      }

      const wordCount = getWordCount(finalTranscript);
      const utteranceAge = utteranceStartedAtRef.current
        ? Date.now() - utteranceStartedAtRef.current
        : 0;

      // If parser is unsure, keep collecting transcript chunks instead of
      // eagerly dispatching UNKNOWN and spamming "not recognized" toasts.
      if (!force && (wordCount < 3 || utteranceAge < MAX_UTTERANCE_MS)) {
        if (transcriptTimerRef.current) {
          window.clearTimeout(transcriptTimerRef.current);
        }
        transcriptTimerRef.current = window.setTimeout(
          () => finalizeTranscript(true),
          CONTINUATION_RETRY_MS
        );
        setStatus("listening");
        return;
      }

      if (debug) {
        console.log("[VOICE] Ignored transcript (no intent match):", finalTranscript);
      }

      clearTranscriptBuffer();
      setStatus("listening");
    },
    [clearTranscriptBuffer, debug, getWordCount, onCommand]
  );

  const handleTranscript = useCallback(
    (event: ReceiveMessageEvent) => {
      const data = event.data;
      if (data.message === "AudioAdded") {
        if (debug) {
          const now = Date.now();
          if (now - lastAudioAckAtRef.current > 1000) {
            lastAudioAckAtRef.current = now;
            console.log("[VOICE] Server acknowledged audio chunks");
          }
        }
        return;
      }

      if (data.message === "RecognitionStarted") {
        if (debug) {
          console.log("[VOICE] Recognition started");
        }
        return;
      }

      if (data.message === "Warning") {
        console.warn("[VOICE] Warning:", data);
        return;
      }

      if (data.message === "Error") {
        console.error("[VOICE] Error:", data);
        return;
      }

      if (data.message === "EndOfUtterance") {
        finalizeTranscript(true);
        return;
      }

      if (data.message !== "AddTranscript") return;

      const transcript = data.metadata?.transcript?.trim();
      if (!transcript) return;

      const trimmed = transcript.trim();
      if (!trimmed) return;
      if (/^[\s.,!?;:]+$/.test(trimmed)) return;

      const existing = transcriptBufferRef.current.trim();
      let nextBuffer = "";
      if (!existing) {
        nextBuffer = trimmed;
      } else if (trimmed.startsWith(existing)) {
        nextBuffer = trimmed;
      } else if (existing.startsWith(trimmed)) {
        nextBuffer = existing;
      } else {
        nextBuffer = `${existing} ${trimmed}`;
      }

      transcriptBufferRef.current = nextBuffer;
      const now = Date.now();
      if (!utteranceStartedAtRef.current) {
        utteranceStartedAtRef.current = now;
      }
      lastTranscriptAtRef.current = now;
      setLastTranscript(nextBuffer);
      setStatus("processing");

      if (debug) {
        console.log("[VOICE] Transcript:", trimmed);
      }

      if (transcriptTimerRef.current) {
        window.clearTimeout(transcriptTimerRef.current);
        transcriptTimerRef.current = null;
      }

      const endsSentence = /[.!?]$/.test(trimmed);
      transcriptTimerRef.current = window.setTimeout(
        () => finalizeTranscript(false),
        endsSentence ? POST_PUNCTUATION_FINALIZE_MS : IDLE_FINALIZE_MS
      );
    },
    [debug, finalizeTranscript]
  );

  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (isListening) return;

    try {
      const tokenRes = await fetch("/api/speechmatics/token", { method: "POST" });
      if (!tokenRes.ok) {
        const msg = await tokenRes.text();
        throw new Error(msg || "Failed to fetch Speechmatics token");
      }
      const tokenData = await tokenRes.json();
      const jwt = tokenData?.jwt as string | undefined;
      if (!jwt) {
        throw new Error("Speechmatics token response missing jwt");
      }

      setError(null);
      setStatus("listening");

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = mediaStream;

      const audioContext = new window.AudioContext();
      audioContextRef.current = audioContext;

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      sourceNodeRef.current = sourceNode;
      processorNodeRef.current = processorNode;

      const client = createSpeechmaticsClient();
      clientRef.current = client;

      client.addEventListener("receiveMessage", handleTranscript);
      client.addEventListener("socketStateChange", (state) => {
        if (state.socketState === "closed" && isListening) {
          setIsListening(false);
          setStatus("idle");
        }
      });

      await client.start(jwt, {
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
          sample_rate: audioContext.sampleRate,
        },
        transcription_config: {
          language,
          enable_partials: false,
          max_delay: 1,
          operating_point: "standard",
          conversation_config: {
            end_of_utterance_silence_trigger: 0.7,
          },
        },
      });

      processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
        const liveClient = clientRef.current;
        if (!liveClient) return;
        const channelData = e.inputBuffer.getChannelData(0);
        const pcmChunk = float32ToInt16PCM(channelData);
        if (debug) {
          const now = Date.now();
          if (now - lastAudioLogAtRef.current > 1000) {
            lastAudioLogAtRef.current = now;
            let sum = 0;
            for (let i = 0; i < channelData.length; i += 1) {
              sum += channelData[i] * channelData[i];
            }
            const rms = Math.sqrt(sum / channelData.length);
            console.log("[VOICE] Audio chunk sent", {
              bytes: pcmChunk.byteLength,
              rms: Number(rms.toFixed(3)),
            });
          }
        }
        try {
          liveClient.sendAudio(pcmChunk);
        } catch {
          // Socket might close while audio callback is still active.
        }
      };

      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);

      setIsListening(true);
      setStatus("listening");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice start failed";
      console.log("Voice command error:", err);
      setError(message);
      setStatus("error");
      setIsListening(false);
      await stopListening();
    }
  }, [debug, handleTranscript, isListening, language, stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    status,
    error,
    lastTranscript,
    startListening,
    stopListening,
  };
}
