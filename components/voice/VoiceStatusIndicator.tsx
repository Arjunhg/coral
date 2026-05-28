import React from "react";
import { Badge } from "@/components/ui/badge";
import type { VoiceStatus } from "@/hooks/useVoiceCommands";

type Props = {
  status: VoiceStatus;
};

const STATUS_STYLES: Record<VoiceStatus, string> = {
  idle: "bg-gray-100 text-gray-700",
  listening: "bg-emerald-100 text-emerald-700 animate-pulse",
  processing: "bg-amber-100 text-amber-700",
  error: "bg-rose-100 text-rose-700",
};

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  processing: "Processing",
  error: "Error",
};

export function VoiceStatusIndicator({ status }: Props) {
  return (
    <Badge className={`${STATUS_STYLES[status]} border-none text-[10px] sm:text-xs px-2 py-0.5`}>
      <span className="hidden min-[361px]:inline">Voice: </span>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
