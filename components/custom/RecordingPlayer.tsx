"use client";

import React, { useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle, Film } from "lucide-react";

type PageMeta = {
    pageId: string;
    url: string;
    startTimeMs: number;
    endTimeMs: number;
};

type RecordingPlayerProps = {
    /** Test case id whose Browserbase recording should be replayed. */
    testCaseId: number | string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/**
 * In-app session replay using the Browserbase HLS Session Replay API.
 *
 * Flow:
 *  1. Fetch /api/test-cases/{id}/recording  → get { sessionId, pages[] }
 *  2. For the first page, load the HLS playlist via
 *     /api/test-cases/{id}/recording/{pageId}  (our server proxies with the API key)
 *  3. Feed the playlist URL to hls.js (loaded dynamically) → play in a <video>
 *
 * End users never need a Browserbase account.
 */
export function RecordingPlayer({
    testCaseId,
    open,
    onOpenChange,
}: RecordingPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pages, setPages] = useState<PageMeta[]>([]);
    const [activePageId, setActivePageId] = useState<string | null>(null);

    /** Destroy the current HLS instance cleanly */
    const destroyHls = () => {
        try {
            hlsRef.current?.destroy();
        } catch {
            /* no-op */
        }
        hlsRef.current = null;
    };

    /**
     * Load an HLS playlist into the video element.
     * Sets loading=true for the full duration of the fetch + manifest parse,
     * so the spinner fires on both the initial load AND tab switches.
     */
    const loadPlaylist = async (pageId: string) => {
        if (!videoRef.current || !testCaseId) return;
        destroyHls();
        setActivePageId(pageId);
        setLoading(true);   // ← show spinner immediately on every tab switch
        setError(null);

        const playlistUrl = `/api/test-cases/${testCaseId}/recording/${pageId}`;

        // Dynamically import hls.js so it never runs on the server
        const { default: Hls } = await import("hls.js");

        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: false });
            hlsRef.current = hls;
            hls.loadSource(playlistUrl);
            hls.attachMedia(videoRef.current);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setLoading(false); // ← hide spinner once the manifest is ready
                videoRef.current?.play().catch(() => {/* autoplay blocked — user can press play */});
            });
            hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
                if (data.fatal) {
                    setLoading(false);
                    setError("Failed to load HLS stream. The recording may have expired.");
                }
            });
        } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari native HLS — spinner clears on the loadedmetadata event
            videoRef.current.src = playlistUrl;
            videoRef.current.onloadedmetadata = () => setLoading(false);
            videoRef.current.play().catch(() => {});
        } else {
            setLoading(false);
            setError("Your browser does not support HLS video playback. Try Chrome, Firefox, Edge, or Safari.");
        }
    };

    useEffect(() => {
        if (!open || testCaseId == null) return;

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            setPages([]);
            setActivePageId(null);
            destroyHls();

            try {
                const res = await fetch(`/api/test-cases/${testCaseId}/recording`);
                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data?.error || "Failed to load recording");
                }

                if (!data.pages || data.pages.length === 0) {
                    throw new Error("No replay pages found for this session.");
                }

                if (cancelled) return;

                setPages(data.pages);

                // Auto-load the first page
                await loadPlaylist(data.pages[0].pageId);
            } catch (e: any) {
                if (!cancelled) {
                    setError(e?.message || "Failed to load recording");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();

        return () => {
            cancelled = true;
            destroyHls();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, testCaseId]);

    // Switch page tab — loading state is handled inside loadPlaylist
    const handlePageChange = (pageId: string) => {
        if (pageId === activePageId) return;
        loadPlaylist(pageId);
    };

    const formatDuration = (startMs: number, endMs: number) => {
        const sec = Math.round((endMs - startMs) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    /**
     * Extract a short, readable path hint from the Browserbase page URL.
     * e.g. "/v1/sessions/abc.../replays/0" → "replays/0"
     * Shown as a sub-label inside each tab button and as a full tooltip.
     */
    const formatPageUrl = (url: string) => {
        try {
            // url is a relative Browserbase API path, e.g. /v1/sessions/{id}/replays/0
            const parts = url.replace(/^\//, "").split("/");
            // Return the last two meaningful segments: "replays/0"
            return parts.slice(-2).join("/");
        } catch {
            return url;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Film className="h-5 w-5 text-primary" />
                        Session Recording
                    </DialogTitle>
                    <DialogDescription>
                        Replay of the cloud browser run for this test case.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative min-h-[320px] w-full flex flex-col gap-3">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 z-10 bg-white/80">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <span className="text-sm">Loading recording…</span>
                        </div>
                    )}

                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center gap-2 text-center px-6 py-10 text-gray-600">
                            <AlertTriangle className="h-6 w-6 text-amber-500" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    )}

                    {pages.length > 1 && (
                        <div className="flex gap-2 flex-wrap">
                            {pages.map((page, idx) => {
                                const urlHint = formatPageUrl(page.url);
                                const isActive = activePageId === page.pageId;
                                return (
                                    <button
                                        key={page.pageId}
                                        onClick={() => handlePageChange(page.pageId)}
                                        disabled={loading}
                                        title={page.url} // full path as tooltip for power users
                                        className={`flex flex-col items-start px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                            isActive
                                                ? "bg-primary text-white border-primary"
                                                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                                        }`}
                                    >
                                        <span>
                                            Tab {idx + 1}
                                            {" · "}
                                            {formatDuration(page.startTimeMs, page.endTimeMs)}
                                        </span>
                                        {/* URL context: truncated path so users can identify the right tab */}
                                        <span className={`text-[10px] font-normal mt-0.5 ${
                                            isActive ? "text-white/80" : "text-gray-400"
                                        }`}>
                                            {urlHint}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* HLS video player */}
                    <video
                        ref={videoRef}
                        controls
                        muted
                        autoPlay
                        playsInline
                        className={`w-full rounded-lg bg-black ${loading || error ? "hidden" : "block"}`}
                        style={{ maxHeight: "520px" }}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default RecordingPlayer;