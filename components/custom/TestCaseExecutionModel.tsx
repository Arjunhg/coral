"use client";

import { useState, useEffect, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TestCase } from "./UserRepoList";
import {
    Play,
    CheckCircle2,
    XCircle,
    Loader2,
    Terminal,
    ExternalLink,
    Globe,
    Code,
    RefreshCw,
    PlayCircle,
    ChevronRight,
    Sparkles,
    Database,
    SlidersHorizontal,
    ChevronDown,
    ChevronUp,
    Eye,
} from "lucide-react";
import axios from "axios";
import { UserDetailContext } from "@/context/UserDetailContext";
import { useContext } from "react";
import { speakTestSummary } from "@/lib/speechmatics/voiceReadback";
import AgentTracePanel from "@/components/custom/AgentTracePanel";

type Props = {
    isOpen: boolean;
    onClose: () => void;
    testCases: TestCase[];
    repository: any; // Connected repository config
};

type FailureContextItem = {
    kind: "issue" | "commit" | "sentry" | "linear" | string;
    source: string;
    title: string;
    url: string | null;
    timestamp: string | null;
    metadata?: Record<string, unknown>;
};

type FailureContext = {
    items: FailureContextItem[];
    queries_run: { source: string; sql: string; rows: number; ms: number }[];
    coral_available: boolean;
};

type RunResult = {
    testCaseId: number;
    status: "idle" | "generating" | "running" | "passed" | "failed";
    logs: string[];
    error?: string;
    sessionId?: string;
    sessionUrl?: string;
    browserbaseScript?: string;
    visionAnalysis?: string;
    failureContext?: FailureContext | null;
};

function extractVisionAnalysisFromLogs(logs?: string[]): string | null {
    if (!Array.isArray(logs) || logs.length === 0) return null;
    const hasVisionMarkers = logs.some((line) => /vision analysis/i.test(line));
    if (!hasVisionMarkers) return null;

    const isSystemNoise = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (trimmed.startsWith("[SYSTEM]")) return true;
        if (trimmed.startsWith("[SYSTEM ERROR]")) return true;
        if (trimmed.startsWith("[BROWSER]")) return true;
        if (/^(\[ERROR\]|\[WARN\])/.test(trimmed)) return true;
        return false;
    };

    const isStartMarker = (line: string) =>
        /vision analysis result/i.test(line) || /vision analysis completed/i.test(line);
    const isEndMarker = (line: string) => /end vision analysis/i.test(line);

    let startIndex = -1;
    for (let i = 0; i < logs.length; i++) {
        if (isStartMarker(logs[i])) {
            startIndex = i + 1;
            break;
        }
    }

    if (startIndex >= 0) {
        const analysisLines: string[] = [];
        for (let i = startIndex; i < logs.length; i++) {
            const line = logs[i];
            if (isEndMarker(line)) break;
            if (!isSystemNoise(line)) {
                analysisLines.push(line.trim());
            }
        }
        const extracted = analysisLines.join("\n").trim();
        if (extracted) return extracted;
    }

    for (let i = logs.length - 1; i >= 0; i--) {
        if (!isSystemNoise(logs[i]) && !isEndMarker(logs[i])) {
            return logs[i].trim();
        }
    }

    return null;
}

export default function TestExecutionModal({ isOpen, onClose, testCases, repository }: Props) {
    const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
    const [currentIdx, setCurrentIdx] = useState<number>(-1);
    const [isExecuting, setIsExecuting] = useState(false);
    const [results, setResults] = useState<Record<number, RunResult>>({});
    const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
    const [detailTab, setDetailTab] = useState<"script" | "analysis" | "context" | "trace" | "terminal">("script");

    const { userDetail, setUserDetail } = useContext(UserDetailContext);

    // Advanced Options states
    const [executionMode, setExecutionMode] = useState<"cache" | "generate">("cache");
    const [customPrompt, setCustomPrompt] = useState("");
    const [showOptions, setShowOptions] = useState(false);
    const hasSpokenRunSummaryRef = useRef(false);

    // Initialize states when testCases change or modal opens
    useEffect(() => {
        if (isOpen && testCases.length > 0) {
            const initial: Record<number, RunResult> = {};
            testCases.forEach((tc) => {
                const tcStatus = (tc as any).status;
                const tcLogs = (tc as any).logs;
                const hasPreviousLogs = Array.isArray(tcLogs) && tcLogs.length > 0;

                initial[tc.id] = {
                    testCaseId: tc.id,
                    status: (tcStatus === "passed" || tcStatus === "failed") ? tcStatus : "idle",
                    logs: hasPreviousLogs ? tcLogs : ["Waiting to run..."],
                    browserbaseScript: tc.browserbaseScript || undefined,
                    sessionId: (tc as any).sessionId || (tc as any).session_id || undefined,
                    sessionUrl: (tc as any).sessionUrl || (tc as any).session_url || undefined,
                    visionAnalysis:
                        (tc as any).visionAnalysis ||
                        (tc as any).vision_analysis ||
                        undefined,
                    failureContext:
                        (tc as any).failureContext ||
                        (tc as any).failure_context ||
                        null,
                };
            });
            setResults(initial);
            setSelectedDetailId(testCases[0].id);
            setCurrentIdx(-1);
            setIsExecuting(false);
            setCustomPrompt("");
            hasSpokenRunSummaryRef.current = false;
            setDetailTab("script");

            // Prefill with repository's saved website URL if available
            setBaseUrl(repository?.targetDomain || repository?.websiteUrl || "http://localhost:3000");

            // Auto-detect if any selected testcase doesn't have a cached script. 
            // If even one doesn't have a script, default to "generate" mode.
            const hasMissingScript = testCases.some(tc => !tc.browserbaseScript);
            setExecutionMode(hasMissingScript ? "generate" : "cache");
        }
    }, [isOpen, testCases, repository]);

    // Handle executing the queue sequentially
    useEffect(() => {
        if (!isExecuting || currentIdx < 0 || currentIdx >= testCases.length) {
            if (currentIdx >= testCases.length) {
                setIsExecuting(false);
            }
            return;
        }

        const runTest = async () => {
            const currentTestCase = testCases[currentIdx];
            const tcId = currentTestCase.id;

            setSelectedDetailId(tcId);

            const isRegenerating = executionMode === "generate" || !results[tcId]?.browserbaseScript;

            setResults((prev) => ({
                ...prev,
                [tcId]: {
                    ...prev[tcId],
                    status: isRegenerating ? "generating" : "running",
                    logs: [
                        isRegenerating
                            ? "[SYSTEM] Connecting to AI agent to analyze files and generate script..."
                            : "[SYSTEM] Found pre-generated script cached in database, preparing execution..."
                    ],
                },
            }));

            try {
                // Call run API with advanced flags
                const res = await axios.post("/api/test-cases/run", {
                    testCaseId: tcId,
                    baseUrl: baseUrl.trim(),
                    mode: executionMode, // "cache" (direct run) or "generate" (regenerate)
                    customPrompt: customPrompt.trim(),
                });

                const data = res.data;
                const parsedVisionAnalysis =
                    data.visionAnalysis ||
                    data.vision_analysis ||
                    extractVisionAnalysisFromLogs(data.logs);

                if (data.credits !== undefined) {
                    setUserDetail((prev: any) => ({ ...prev, credits: data.credits }));
                }

                setResults((prev) => ({
                    ...prev,
                    [tcId]: {
                        testCaseId: tcId,
                        status: data.status,
                        logs: data.logs || [],
                        browserbaseScript: data.browserbaseScript,
                        sessionId: data.sessionId,
                        sessionUrl: data.sessionUrl,
                        visionAnalysis: parsedVisionAnalysis || undefined,
                        failureContext: data.failureContext ?? data.failure_context ?? null,
                        error: data.error,
                    },
                }));
            } catch (err: any) {
                const errMsg = err.response?.data?.error || err.message || "Execution failed";
                const errorLogs = err.response?.data?.logs;
                const parsedVisionAnalysis =
                    err.response?.data?.visionAnalysis ||
                    err.response?.data?.vision_analysis ||
                    extractVisionAnalysisFromLogs(errorLogs);
                
                if (err.response?.data?.credits !== undefined) {
                    setUserDetail((prev: any) => ({ ...prev, credits: err.response.data.credits }));
                }

                setResults((prev) => ({
                    ...prev,
                    [tcId]: {
                        ...prev[tcId],
                        status: "failed",
                        error: errMsg,
                        visionAnalysis: parsedVisionAnalysis || undefined,
                        failureContext: err.response?.data?.failureContext ?? err.response?.data?.failure_context ?? null,
                        logs: Array.isArray(errorLogs)
                            ? errorLogs
                            : [...(prev[tcId]?.logs || []), `[SYSTEM ERROR] ${errMsg}`],
                    },
                }));
            }

            // Move to next item in the queue
            setCurrentIdx((prev) => prev + 1);
        };

        runTest();
    }, [isExecuting, currentIdx, testCases, baseUrl, executionMode]);

    const startExecution = () => {
        // Reset all statuses
        const resetResults: Record<number, RunResult> = {};
        testCases.forEach((tc) => {
            resetResults[tc.id] = {
                testCaseId: tc.id,
                status: "idle",
                logs: ["Queued..."],
                browserbaseScript: tc.browserbaseScript || undefined,
                failureContext:
                    (tc as any).failureContext ||
                    (tc as any).failure_context ||
                    null,
            };
        });
        setResults(resetResults);
        setIsExecuting(true);
        setCurrentIdx(0);
        setSelectedDetailId(testCases[0].id);
        hasSpokenRunSummaryRef.current = false;
    };

    const stopExecution = () => {
        setIsExecuting(false);
        setCurrentIdx(-1);
    };

    const currentSelectedResult = selectedDetailId ? results[selectedDetailId] : null;
    const currentSelectedTestCase = testCases.find((tc) => tc.id === selectedDetailId);
    const resolvedVisionAnalysis =
        currentSelectedResult?.visionAnalysis ||
        extractVisionAnalysisFromLogs(currentSelectedResult?.logs);
    const hasScript = Boolean(currentSelectedResult?.browserbaseScript);
    const hasAnalysis = Boolean(resolvedVisionAnalysis);
    const hasContext = Boolean(currentSelectedResult?.failureContext);
    const coralAvailable = currentSelectedResult?.failureContext?.coral_available ?? false;

    useEffect(() => {
        setDetailTab("script");
    }, [selectedDetailId]);

    useEffect(() => {
        if (
            isExecuting ||
            hasSpokenRunSummaryRef.current ||
            testCases.length === 0 ||
            currentIdx < testCases.length
        ) {
            return;
        }

        const queueResults = testCases.map((tc) => results[tc.id]).filter(Boolean);
        const total = queueResults.length;
        const passed = queueResults.filter((res) => res?.status === "passed").length;
        const failed = queueResults.filter((res) => res?.status === "failed").length;

        hasSpokenRunSummaryRef.current = true;
        speakTestSummary(passed, failed, total);
    }, [currentIdx, isExecuting, results, testCases]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl h-[95dvh] sm:h-[90vh] flex flex-col p-3 sm:p-6 gap-3 sm:gap-4 bg-white rounded-2xl shadow-2xl border overflow-hidden">
                <DialogHeader className="border-b pb-3 sm:pb-4 flex flex-row items-center justify-between shrink-0">
                    <div>
                        <DialogTitle className="text-base min-[361px]:text-lg sm:text-2xl font-bold text-gray-900 flex items-center gap-2 pr-7 sm:pr-10">
                            <PlayCircle className="text-primary h-6 w-6" />
                            Browserbase Cloud Test Runner
                        </DialogTitle>
                        <DialogDescription className="text-gray-500 text-xs sm:text-sm">
                            Run automation scripts completely in the cloud using Browserbase headless infrastructure.
                        </DialogDescription>
                    </div>
                </DialogHeader>

                {/* Target Configuration Header */}
                <div className="flex flex-col bg-gray-50 p-3 sm:p-4 rounded-2xl border border-gray-200/80 gap-3 shrink-0">
                    <div className="flex flex-col sm:flex-row gap-4 items-end">
                        <div className="flex-1 space-y-1.5">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                <Globe className="h-3.5 w-3.5 text-primary" /> Target Website URL
                            </label>
                            <Input
                                placeholder="e.g. http://localhost:3000"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                disabled={isExecuting}
                                className="bg-white border-gray-300 font-mono text-sm shadow-xs h-10"
                            />
                        </div>
                        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowOptions(!showOptions)}
                                className={`h-10 w-full sm:w-auto px-3 sm:px-4 font-medium text-[11px] sm:text-xs gap-1.5 transition-colors border-gray-300 ${showOptions ? "bg-primary/5 text-primary border-primary/30" : ""}`}
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                <span className="hidden min-[361px]:inline">Execution Options</span>
                                <span className="min-[361px]:hidden">Options</span>
                                {showOptions ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                            </Button>
                            {!isExecuting ? (
                                <Button
                                    onClick={startExecution}
                                    className="h-10 w-full sm:w-auto bg-primary hover:bg-primary/95 text-white shadow-md font-medium px-4 sm:px-6 gap-2 text-[11px] sm:text-sm"
                                >
                                    <Play className="h-4 w-4 fill-white" />
                                    <span className="hidden min-[361px]:inline">Start Execution</span>
                                    <span className="min-[361px]:hidden">Start</span>
                                </Button>
                            ) : (
                                <Button
                                    onClick={stopExecution}
                                    variant="destructive"
                                    className="h-10 w-full sm:w-auto px-4 sm:px-6 font-medium gap-2 text-[11px] sm:text-sm"
                                >
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="hidden min-[361px]:inline">Stop Runner</span>
                                    <span className="min-[361px]:hidden">Stop</span>
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Expandable Advanced Options Section */}
                    {showOptions && (
                        <div className="pt-3 border-t border-gray-200/60 grid grid-cols-1 md:grid-cols-3 gap-5 animate-in fade-in slide-in-from-top-2 duration-200">
                            {/* Execution Mode Segment */}
                            <div className="md:col-span-1 space-y-1.5">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Run Mode</span>
                                <div className="grid grid-cols-2 bg-gray-200/60 p-1 rounded-lg border border-gray-200">
                                    <button
                                        type="button"
                                        disabled={isExecuting}
                                        onClick={() => setExecutionMode("cache")}
                                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${executionMode === "cache"
                                                ? "bg-white text-gray-800 shadow-xs"
                                                : "text-gray-500 hover:text-gray-700"
                                            } disabled:opacity-50`}
                                    >
                                        <Database className="h-3.5 w-3.5" /> Run Cached
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isExecuting}
                                        onClick={() => setExecutionMode("generate")}
                                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${executionMode === "generate"
                                                ? "bg-white text-gray-800 shadow-xs"
                                                : "text-gray-500 hover:text-gray-700"
                                            } disabled:opacity-50`}
                                    >
                                        <Sparkles className="h-3.5 w-3.5 text-yellow-600" /> AI Regenerate
                                    </button>
                                </div>
                            </div>

                            {/* Temporary Prompt/Instruction Override Textarea */}
                            <div className="md:col-span-2 space-y-1.5">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                    Custom Run Instructions (Merged with Global Settings)
                                </span>
                                <textarea
                                    placeholder="e.g. Make sure to click the profile dropdown before asserting, or wait 1s after clicks..."
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    disabled={isExecuting || executionMode === "cache"}
                                    rows={1.5}
                                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-sans focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 disabled:bg-gray-100 shadow-xs resize-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Main Dashboard Panel */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5 overflow-hidden">
                    {/* Left: Test Cases Queue List */}
                    <div className="md:col-span-1 border rounded-xl overflow-y-auto bg-gray-50/50 p-2.5 sm:p-3 flex flex-col gap-2 shadow-xs max-h-52 md:max-h-none">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 mb-1">
                            Execution Queue
                        </h3>
                        {testCases.map((tc, index) => {
                            const res = results[tc.id];
                            const isActive = selectedDetailId === tc.id;
                            const isRunning = currentIdx === index && isExecuting;

                            return (
                                <div
                                    key={tc.id}
                                    onClick={() => setSelectedDetailId(tc.id)}
                                    className={`p-2.5 sm:p-3 rounded-lg border cursor-pointer transition-all ${isActive
                                            ? "bg-white border-primary shadow-sm ring-1 ring-primary/20"
                                            : "bg-white border-gray-200 hover:border-gray-300 shadow-xs"
                                        }`}
                                >
                                    <div className="flex justify-between items-start gap-2 mb-1">
                                        <h4 className="font-semibold text-xs sm:text-sm text-gray-800 line-clamp-1">
                                            {tc.title}
                                        </h4>
                                        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isActive ? "rotate-90 text-primary" : ""}`} />
                                    </div>
                                    <p className="text-[11px] sm:text-xs text-gray-400 line-clamp-1 mb-2.5">
                                        {tc.description}
                                    </p>
                                    <div className="flex justify-between items-center">
                                        <Badge variant="outline" className="text-[10px] font-mono capitalize">
                                            {tc.type}
                                        </Badge>
                                        <StatusBadge status={res?.status || "idle"} isRunning={isRunning} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Right: Code, Live Logs & Details Panel */}
                    <div className="md:col-span-2 border rounded-xl flex flex-col bg-white overflow-hidden shadow-sm min-h-0">
                        {currentSelectedTestCase ? (
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {/* Header Info */}
                                <div className="p-3 sm:p-4 border-b bg-gray-50/50 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4 shrink-0">
                                    <div>
                                        <h3 className="font-bold text-sm sm:text-base text-gray-800">
                                            {currentSelectedTestCase.title}
                                        </h3>
                                        <p className="text-[11px] sm:text-xs text-gray-500 mt-1">
                                            Expected: {currentSelectedTestCase.expectedResult}
                                        </p>
                                    </div>
                                    {currentSelectedResult?.sessionUrl && (
                                        <Button
                                            onClick={() => window.open(currentSelectedResult.sessionUrl, "_blank")}
                                            variant="outline"
                                            size="sm"
                                            className="font-medium text-xs gap-1 border-primary/30 text-primary hover:bg-primary/5 shadow-xs shrink-0 w-full sm:w-auto"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" /> Watch Recording
                                        </Button>
                                    )}
                                </div>

                                {/* Body split: Code Accordion + Terminal */}
                                <div className="flex-1 flex flex-col p-2.5 sm:p-4 gap-3 sm:gap-4 min-h-0">
                                    <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-1">
                                        <button
                                            type="button"
                                            onClick={() => setDetailTab("script")}
                                            className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold border transition-colors ${detailTab === "script"
                                                    ? "bg-primary/10 text-primary border-primary/40"
                                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                                }`}
                                        >
                                            Playwright Script
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => hasAnalysis && setDetailTab("analysis")}
                                            disabled={!hasAnalysis}
                                            className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold border transition-colors ${detailTab === "analysis"
                                                    ? "bg-violet-100 text-violet-900 border-violet-200"
                                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                                } ${!hasAnalysis ? "opacity-50 cursor-not-allowed" : ""}`}
                                        >
                                            Failure Analysis
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => hasContext && setDetailTab("context")}
                                            disabled={!hasContext}
                                            className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold border transition-colors ${detailTab === "context"
                                                    ? "bg-blue-100 text-blue-900 border-blue-200"
                                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                                } ${!hasContext ? "opacity-50 cursor-not-allowed" : ""}`}
                                        >
                                            Related Context
                                            {hasContext && (
                                                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-blue-200 text-blue-900 text-[9px] font-bold w-4 h-4">
                                                    {currentSelectedResult?.failureContext?.items.length}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDetailTab("trace")}
                                            className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold border transition-colors ${detailTab === "trace"
                                                    ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                                }`}
                                        >
                                            Agent Trace
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDetailTab("terminal")}
                                            className={`px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold border transition-colors ${detailTab === "terminal"
                                                    ? "bg-gray-900 text-white border-gray-900"
                                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                                }`}
                                        >
                                            Terminal
                                        </button>
                                    </div>

                                    <div className="flex-1 min-h-0">
                                        {detailTab === "script" && (
                                            <div className="rounded-lg border overflow-hidden h-full flex flex-col min-h-0">
                                                <div className="bg-gray-100 px-3.5 py-2 border-b flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                                                        <Code className="h-3.5 w-3.5 text-primary" /> Generated Playwright Code
                                                    </span>
                                                </div>
                                                {hasScript ? (
                                                    <pre className="flex-1 p-3 bg-gray-950 text-emerald-400 font-mono text-[11px] leading-relaxed overflow-auto scrollbar-hide select-text">
                                                        {currentSelectedResult?.browserbaseScript}
                                                    </pre>
                                                ) : (
                                                    <div className="flex-1 p-4 text-sm text-gray-500 bg-white">
                                                        No script available yet. Run the test to generate the Playwright script.
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {detailTab === "analysis" && (
                                            <div className="rounded-lg border border-violet-200 bg-violet-50/60 overflow-hidden h-full flex flex-col min-h-0">
                                                <div className="bg-violet-100/80 px-3.5 py-2 border-b border-violet-200 flex items-center gap-1.5">
                                                    <Eye className="h-3.5 w-3.5 text-violet-700" />
                                                    <span className="text-xs font-semibold text-violet-900">
                                                        AI Vision Failure Analysis
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className="ml-auto text-[10px] border-violet-300 text-violet-700 bg-white"
                                                    >
                                                        Featherless
                                                    </Badge>
                                                </div>
                                                {hasAnalysis ? (
                                                    <div className="flex-1 p-3.5 text-sm text-violet-950 leading-relaxed whitespace-pre-wrap overflow-auto scrollbar-hide select-text">
                                                        {resolvedVisionAnalysis}
                                                    </div>
                                                ) : (
                                                    <div className="flex-1 p-4 text-sm text-violet-900/70">
                                                        No failure analysis available for this run.
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {detailTab === "context" && (
                                            <div className="rounded-lg border border-blue-200 bg-blue-50/40 overflow-hidden h-full flex flex-col min-h-0">
                                                <div className="bg-blue-100/70 px-3.5 py-2 border-b border-blue-200 flex items-center gap-1.5">
                                                    <Database className="h-3.5 w-3.5 text-blue-700" />
                                                    <span className="text-xs font-semibold text-blue-900">
                                                        Cross-Source Context (via Coral)
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className="ml-auto text-[10px] border-blue-300 text-blue-700 bg-white"
                                                    >
                                                        {currentSelectedResult?.failureContext?.queries_run.length ?? 0} queries
                                                    </Badge>
                                                </div>
                                                <div className="flex-1 overflow-auto scrollbar-hide p-3 space-y-3 select-text">
                                                    {currentSelectedResult?.failureContext?.items.length === 0 && (
                                                        <p className="text-sm text-blue-900/70">
                                                            {coralAvailable
                                                                ? "No related items found across connected sources."
                                                                : "Coral is unavailable or no sources are configured for this workspace."}
                                                        </p>
                                                    )}

                                                    {currentSelectedResult?.failureContext?.items.map((item, idx) => (
                                                        <a
                                                            key={`${item.source}-${idx}`}
                                                            href={item.url || "#"}
                                                            target={item.url ? "_blank" : undefined}
                                                            rel="noopener noreferrer"
                                                            className={`block rounded-md border p-3 bg-white hover:border-blue-400 transition-colors ${item.url ? "cursor-pointer" : "cursor-default"}`}
                                                            onClick={(e) => !item.url && e.preventDefault()}
                                                        >
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <Badge
                                                                    className={`text-[10px] uppercase ${item.kind === "issue" ? "bg-amber-100 text-amber-800" :
                                                                            item.kind === "commit" ? "bg-emerald-100 text-emerald-800" :
                                                                                item.kind === "sentry" ? "bg-rose-100 text-rose-800" :
                                                                                    item.kind === "linear" ? "bg-violet-100 text-violet-800" :
                                                                                        item.kind === "splunk" ? "bg-orange-100 text-orange-800" :
                                                                                        "bg-gray-100 text-gray-800"
                                                                        }`}
                                                                >
                                                                    {item.kind}
                                                                </Badge>
                                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                                                                    item.source === "github" ? "bg-slate-100 text-slate-700" :
                                                                        item.source === "sentry" ? "bg-rose-100 text-rose-700" :
                                                                            item.source === "linear" ? "bg-violet-100 text-violet-700" :
                                                                                item.source === "splunk" ? "bg-orange-100 text-orange-700" :
                                                                                    "bg-gray-100 text-gray-600"
                                                                }`}>
                                                                    {item.source}
                                                                </span>
                                                                {item.timestamp && (
                                                                    <span className="text-[10px] text-gray-400 ml-auto">
                                                                        {new Date(item.timestamp).toLocaleDateString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-sm text-gray-800 leading-snug line-clamp-2">{item.title}</p>
                                                            {item.metadata && Object.keys(item.metadata).length > 0 && (
                                                                <p className="text-[11px] text-gray-500 mt-1">
                                                                    {Object.entries(item.metadata)
                                                                        .filter(([, value]) => value !== null && value !== undefined && value !== "")
                                                                        .map(([key, value]) => `${key}: ${String(value)}`)
                                                                        .join(" | ")}
                                                                </p>
                                                            )}
                                                        </a>
                                                    ))}

                                                    {currentSelectedResult?.failureContext?.queries_run && (
                                                        <details className="mt-3 text-[11px]">
                                                            <summary className="cursor-pointer text-blue-700 font-semibold">
                                                                View {currentSelectedResult.failureContext.queries_run.length} SQL queries
                                                            </summary>
                                                            <div className="mt-2 space-y-2">
                                                                {currentSelectedResult.failureContext.queries_run.map((query, i) => (
                                                                    <div
                                                                        key={i}
                                                                        className="rounded bg-gray-950 text-emerald-300 p-2 font-mono text-[10px] leading-relaxed"
                                                                    >
                                                                        <div className="text-blue-400 mb-1">
                                                                            [{query.source}] {query.rows} rows | {query.ms}ms
                                                                        </div>
                                                                        <pre className="whitespace-pre-wrap">{query.sql}</pre>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {detailTab === "trace" && currentSelectedTestCase && (
                                            <AgentTracePanel testCaseId={currentSelectedTestCase.id} />
                                        )}

                                        {detailTab === "terminal" && (
                                            <div className="rounded-lg border overflow-hidden h-full flex flex-col min-h-0">
                                                <div className="bg-gray-950 text-gray-200 px-3 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 font-mono">
                                                    <span className="text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 text-emerald-400">
                                                        <Terminal className="h-3.5 w-3.5" />
                                                        <span className="hidden min-[361px]:inline">Console Terminal Output</span>
                                                        <span className="min-[361px]:hidden">Terminal</span>
                                                    </span>
                                                    <Badge variant="secondary" className="bg-gray-800 text-gray-300 border-none text-[10px] uppercase">
                                                        {currentSelectedResult?.status || "idle"}
                                                    </Badge>
                                                </div>
                                                <div className="flex-1 p-3 bg-gray-950 font-mono text-[11px] text-gray-300 overflow-auto scrollbar-hide flex flex-col gap-1.5 select-text">
                                                    {currentSelectedResult?.logs.map((log, lIdx) => (
                                                        <div key={lIdx} className="leading-relaxed whitespace-pre-wrap">
                                                            {log.startsWith("[SYSTEM]") ? (
                                                                <span className="text-blue-400">{log}</span>
                                                            ) : log.startsWith("[SYSTEM ERROR]") ? (
                                                                <span className="text-rose-400 font-semibold">{log}</span>
                                                            ) : log.startsWith("[BROWSER]") ? (
                                                                <span className="text-purple-400">{log}</span>
                                                            ) : (
                                                                <span>{log}</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {currentSelectedResult?.error && (
                                                        <div className="text-red-400 font-bold mt-2 pt-2 border-t border-gray-800">
                                                            Error: {currentSelectedResult.error}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                                <Terminal className="h-12 w-12 text-gray-300 mb-3" />
                                <h3 className="font-bold text-gray-700 text-lg">No Test Case Selected</h3>
                                <p className="text-sm text-gray-400 mt-1 max-w-sm">
                                    Choose any test case from the queue to inspect its console logs and code.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Controls */}
                <div className="border-t pt-3 sm:pt-4 flex justify-end gap-3 shrink-0">
                    <Button variant="outline" onClick={onClose} disabled={isExecuting} className="h-10 font-medium px-5 w-full sm:w-auto">
                        Close & Refresh Status
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function StatusBadge({
    status,
    isRunning,
}: {
    status: RunResult["status"];
    isRunning: boolean;
}) {
    if (isRunning) {
        return (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none flex gap-1 items-center animate-pulse text-[10px] sm:text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Run
            </Badge>
        );
    }

    switch (status) {
        case "generating":
            return (
                <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none flex gap-1 items-center text-[10px] sm:text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="hidden min-[361px]:inline">Generating...</span>
                    <span className="min-[361px]:hidden">Gen...</span>
                </Badge>
            );
        case "passed":
            return (
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none flex gap-1 items-center text-[10px] sm:text-xs">
                    <CheckCircle2 className="h-3 w-3" /> Pass
                </Badge>
            );
        case "failed":
            return (
                <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 border-none flex gap-1 items-center text-[10px] sm:text-xs">
                    <XCircle className="h-3 w-3" /> Fail
                </Badge>
            );
        case "idle":
        default:
            return (
                <Badge variant="secondary" className="text-gray-600">
                    Queued
                </Badge>
            );
    }
}
