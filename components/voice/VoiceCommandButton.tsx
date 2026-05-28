"use client";

import React from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { VoiceStatusIndicator } from "@/components/voice/VoiceStatusIndicator";
import type { VoiceCommand } from "@/lib/speechmatics/commandParser";

type Props = {
  onCommand: (command: VoiceCommand) => void;
};

export default function VoiceCommandButton({ onCommand }: Props) {
  const { isListening, status, error, startListening, stopListening } =
    useVoiceCommands({ onCommand, debug: true });

  const onToggle = async () => {
    if (isListening) {
      await stopListening();
      return;
    }
    await startListening();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <VoiceStatusIndicator status={status} />
      <Button
        type="button"
        variant={isListening ? "destructive" : "outline"}
        onClick={onToggle}
        className={`gap-1.5 sm:gap-2 text-[11px] sm:text-sm px-2.5 sm:px-4 ${isListening ? "animate-pulse" : ""}`}
        title={isListening ? "Stop voice commands" : "Start voice commands"}
      >
        {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {isListening ? (
          <>
            <span className="hidden min-[361px]:inline">Stop Voice</span>
            <span className="min-[361px]:hidden">Stop</span>
          </>
        ) : (
          <>
            <span className="hidden min-[361px]:inline">Voice Commands</span>
            <span className="min-[361px]:hidden">Voice</span>
          </>
        )}
      </Button>
      {error && <span className="text-xs text-rose-600 max-w-[220px] break-words">{error}</span>}
    </div>
  );
}
