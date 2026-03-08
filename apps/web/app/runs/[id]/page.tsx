'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUp,
  Loader2,
  Sparkles,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  Search,
  FileText,
  Brain,
  Shield,
  ChevronDown,
  AlertCircle,
} from 'lucide-react';
import { TraceTimeline } from '@/components/TraceTimeline';
import { ReportViewer } from '@/components/ReportViewer';
import { useTheme } from '@/components/theme';
import { subscribeToRun } from '@/lib/sse';
import {
  getRun,
  getRunEvents,
  getThreadRuns,
  createRun,
  getUserApiKeys,
  submitSteeringInput,
} from '@/lib/api';
import {
  RunEvent,
  RunResult,
  RunStatusValue,
  formatAgentStateLabel,
} from '@/lib/types';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ── Status badge configs ────────────────────────────────────────────── */

const statusConfig: Record<
  RunStatusValue,
  { label: string; icon: React.ReactNode; className: string; pulse?: boolean }
> = {
  pending: {
    label: TEXT_CONFIG.runPage.status.queued,
    icon: <Clock size={13} />,
    className:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    pulse: true,
  },
  running: {
    label: TEXT_CONFIG.runPage.status.researching,
    icon: <Zap size={13} />,
    className:
      'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
    pulse: true,
  },
  completed: {
    label: TEXT_CONFIG.runPage.status.completed,
    icon: <CheckCircle2 size={13} />,
    className:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  failed: {
    label: TEXT_CONFIG.runPage.status.failed,
    icon: <XCircle size={13} />,
    className:
      'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
};

/* ── State → Icon mapping ────────────────────────────────────────────── */

function stateIcon(state: string | null) {
  if (!state) return <Sparkles size={16} className="text-orange-500" />;
  if (state.includes('search') || state.includes('quer'))
    return <Search size={16} className="text-blue-500" />;
  if (state.includes('synth') || state.includes('report'))
    return <FileText size={16} className="text-emerald-500" />;
  if (state.includes('kg') || state.includes('knowledge'))
    return <Brain size={16} className="text-purple-500" />;
  if (state.includes('verif') || state.includes('critic'))
    return <Shield size={16} className="text-cyan-500" />;
  return <Sparkles size={16} className="text-orange-500" />;
}

/* ── Thinking skeleton ───────────────────────────────────────────────── */

function ThinkingSkeleton({ activeState }: { activeState: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/20 sm:h-8 sm:w-8 sm:rounded-xl"
        >
          {stateIcon(activeState)}
        </motion.div>
        <div>
          <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200 sm:text-sm">
            {activeState
              ? formatAgentStateLabel(activeState)
              : TEXT_CONFIG.runPage.thinkingInit}
          </p>
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500 sm:text-xs">
            {TEXT_CONFIG.runPage.thinkingSubtitle}
          </p>
        </div>
      </div>
      <div className="space-y-2 py-1">
        {[0.85, 1, 0.7, 0.9].map((w, i) => (
          <motion.div
            key={i}
            className="h-2.5 rounded-full bg-gradient-to-r from-neutral-200/60 via-neutral-100/80 to-neutral-200/60 dark:from-white/[0.06] dark:via-white/[0.12] dark:to-white/[0.06] sm:h-3"
            style={{ width: `${w * 100}%` }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1 sm:gap-2">
        {TEXT_CONFIG.runPage.thinkingSteps.map((step, i) => {
          const isActive =
            activeState?.toLowerCase().includes(step.toLowerCase().slice(0, 4));
          return (
            <motion.span
              key={step}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{
                opacity: isActive ? 1 : 0.4,
                scale: isActive ? 1.05 : 1,
              }}
              transition={{ delay: i * 0.1 }}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors sm:gap-1.5 sm:px-3 sm:py-1 sm:text-[11px] ${isActive
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/25'
                : 'bg-neutral-100 text-neutral-400 dark:bg-white/[0.04] dark:text-neutral-600 border border-transparent'
                }`}
            >
              {isActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange-500" />
                </span>
              )}
              {step}
            </motion.span>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function extractFailureMessage(event: RunEvent | null): string | null {
  if (!event) return null;
  const payload = event.payload ?? null;
  if (payload) {
    if (typeof payload.error === 'string' && payload.error.trim())
      return payload.error;
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors.find((item) => typeof item === 'string');
      if (typeof first === 'string' && first.trim()) return first;
    }
  }
  if (event.message && !event.message.startsWith('State:'))
    return event.message;
  return null;
}

function extractSteeringMessage(event: RunEvent): string {
  const payloadMessage =
    event.payload && typeof event.payload.message === 'string'
      ? event.payload.message.trim()
      : '';
  if (payloadMessage) return payloadMessage;
  return event.message;
}

/* ── Chat message type ────────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId: string;
  timestamp: Date;
}

/* ── Collapsible Trace Block ──────────────────────────────────────────── */

function InlineTraceBlock({
  runId,
  events,
  activeState,
  isActive,
}: {
  runId: string;
  events: RunEvent[];
  activeState: string | null;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedEvents, setLoadedEvents] = useState<RunEvent[] | null>(null);

  const traceEvents = isActive ? events : (loadedEvents ?? []);
  const hasEvents = traceEvents.length > 0;

  const handleToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !isActive && loadedEvents === null) {
      setLoading(true);
      try {
        const fetched = await getRunEvents(runId);
        setLoadedEvents(fetched);
      } catch {
        setLoadedEvents([]);
      } finally {
        setLoading(false);
      }
    }
  };

  if (!isActive && loadedEvents !== null && loadedEvents.length === 0 && !open) return null;

  return (
    <div className="rounded-2xl rounded-tl-md border border-emerald-500/20 bg-emerald-50/70 shadow-sm overflow-hidden dark:bg-emerald-500/[0.05] mb-2">
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-2.5 w-full cursor-pointer px-3 py-2 select-none hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors sm:px-4 sm:py-2.5"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500'}`} />
        <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-100 flex-1 text-left truncate">
          {isActive
            ? `Researching · ${events.length} step${events.length !== 1 ? 's' : ''}`
            : `Researched · ${(loadedEvents ?? []).length || '…'} steps`}
        </p>
        {loading ? (
          <Loader2 size={14} className="text-emerald-600/50 animate-spin shrink-0" />
        ) : (
          <ChevronDown
            size={14}
            className={`text-emerald-600/50 dark:text-emerald-400/50 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-3 border-t border-emerald-500/10 bg-white/60 dark:bg-[#0c1220]/60 max-h-[40vh] overflow-y-auto sm:px-4">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="animate-spin text-emerald-500" />
                </div>
              ) : hasEvents ? (
                <TraceTimeline events={traceEvents} activeState={isActive ? activeState : null} />
              ) : (
                <p className="text-xs text-neutral-400 text-center py-4">No trace events.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */

export default function RunPage() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useParams();
  const initialRunId = params.id as string;
  const botLogoSrc =
    theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png';

  // Thread state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runResultsMap, setRunResultsMap] = useState<Record<string, RunResult>>({});

  // Active run state (the latest/currently streaming run)
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeEvents, setActiveEvents] = useState<RunEvent[]>([]);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusValue>('pending');
  const [activeResult, setActiveResult] = useState<RunResult | null>(null);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTrace, setShowTrace] = useState(true);

  // Steering (while a run is active)
  const [steeringInput, setSteeringInput] = useState('');
  const [steeringFeedback, setSteeringFeedback] = useState<string | null>(null);
  const [isSteeringSubmitting, setIsSteeringSubmitting] = useState(false);

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isRunRunning = runStatus === 'pending' || runStatus === 'running';
  const hasActiveRun = Boolean(activeRunId);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeResult, isRunRunning, activeEvents]);

  /* ── Load thread history ─────────────────────────────────────────── */

  useEffect(() => {
    let canceled = false;

    async function loadThread() {
      try {
        const runData = await getRun(initialRunId);
        if (canceled) return;

        const tid = runData.thread_id || initialRunId;
        setThreadId(tid);

        // Load all runs in this thread
        let threadRuns: RunResult[];
        try {
          threadRuns = await getThreadRuns(tid);
        } catch {
          threadRuns = [runData];
        }

        if (canceled) return;

        // Sort by created_at ascending
        threadRuns.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

        // Build chat messages from all thread runs
        const chatMsgs: ChatMessage[] = [];
        const resultsMap: Record<string, RunResult> = {};

        for (const run of threadRuns) {
          chatMsgs.push({
            id: `user-${run.run_id}`,
            role: 'user',
            content: run.query,
            runId: run.run_id,
            timestamp: new Date(run.created_at),
          });

          if (run.report_md) {
            chatMsgs.push({
              id: `assistant-${run.run_id}`,
              role: 'assistant',
              content: run.report_md,
              runId: run.run_id,
              timestamp: new Date(run.updated_at),
            });
            resultsMap[run.run_id] = run;
          }
        }

        setMessages(chatMsgs);
        setRunResultsMap(resultsMap);

        // Check if the latest run is still running
        const latestRun = threadRuns[threadRuns.length - 1];
        if (
          latestRun.status === 'pending' ||
          latestRun.status === 'running'
        ) {
          // Subscribe to the active run
          setActiveRunId(latestRun.run_id);
          setRunStatus(latestRun.status);
          setActiveState(latestRun.current_state);

          const existingEvents = await getRunEvents(latestRun.run_id);
          if (canceled) return;
          setActiveEvents(existingEvents);

          startStreaming(latestRun.run_id);
        } else {
          setRunStatus(latestRun.status);
        }

        setIsLoading(false);
      } catch (err) {
        if (canceled) return;
        setError(
          err instanceof Error ? err.message : TEXT_CONFIG.runPage.loadFailed,
        );
        setIsLoading(false);
      }
    }

    void loadThread();

    return () => {
      canceled = true;
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, [initialRunId]);

  /* ── SSE streaming helper ────────────────────────────────────────── */

  const startStreaming = useCallback((runId: string) => {
    streamCleanupRef.current?.();

    const cleanup = subscribeToRun(runId, {
      onEvent: (event) => {
        setActiveEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          return [...prev, event];
        });
        setActiveState(event.state);
        const failed =
          event.state.includes('fail') || event.state.includes('error');
        setRunStatus(failed ? 'failed' : 'running');
        if (failed) {
          setError(
            extractFailureMessage(event) ??
            TEXT_CONFIG.runPage.runFailedDefault,
          );
        }
      },
      onComplete: (finalResult) => {
        setActiveResult(finalResult);
        setRunStatus(finalResult.status);
        setActiveState(finalResult.current_state);
        setRunResultsMap((prev) => ({ ...prev, [runId]: finalResult }));

        // Add assistant message to chat
        if (finalResult.report_md) {
          setMessages((prev) => {
            if (prev.some((m) => m.runId === runId && m.role === 'assistant'))
              return prev;
            return [
              ...prev,
              {
                id: `assistant-${runId}`,
                role: 'assistant',
                content: finalResult.report_md || '',
                runId: runId,
                timestamp: new Date(),
              },
            ];
          });
        }
      },
      onError: (err) => {
        setError(err.message);
      },
    });

    streamCleanupRef.current = cleanup;
  }, []);

  /* ── Submit follow-up ────────────────────────────────────────────── */

  const handleFollowUp = useCallback(async () => {
    const trimmed = followUpInput.trim();
    if (!trimmed || isSubmitting) return;

    // If a run is currently running, treat as steering input
    if (activeRunId && isRunRunning) {
      setIsSteeringSubmitting(true);
      setSteeringFeedback(null);
      try {
        const resp = await submitSteeringInput(activeRunId, trimmed);
        if (resp.queued) {
          setFollowUpInput('');
          setSteeringFeedback(TEXT_CONFIG.runPage.steeringQueuedSuccess);
        } else {
          setSteeringFeedback(resp.message);
        }
      } catch (err) {
        setSteeringFeedback(
          err instanceof Error ? err.message : TEXT_CONFIG.runPage.steeringQueuedFailure,
        );
      } finally {
        setIsSteeringSubmitting(false);
      }
      return;
    }

    // Check API key
    const keys = getUserApiKeys();
    if (!keys.groqApiKey?.trim()) {
      setError('Please configure your Groq API Key in Settings before continuing.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSteeringFeedback(null);

    // Add user message immediately
    const userMsgId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: trimmed,
        runId: '', // will be set when run is created
        timestamp: new Date(),
      },
    ]);
    setFollowUpInput('');

    try {
      // Build chat_history from existing messages (last 10 for context)
      const chatHistory = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

      const { run_id } = await createRun(
        trimmed,
        { chat_history: chatHistory },
        threadId || undefined,
      );

      // Update the user message with the correct runId
      setMessages((prev) =>
        prev.map((m) => (m.id === userMsgId ? { ...m, runId: run_id } : m)),
      );

      // Set up the new active run
      setActiveRunId(run_id);
      setRunStatus('pending');
      setActiveState(null);
      setActiveEvents([]);
      setActiveResult(null);

      // Navigate to the new run URL without full reload
      window.history.replaceState({}, '', `/runs/${run_id}`);

      startStreaming(run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start follow-up');
    } finally {
      setIsSubmitting(false);
    }
  }, [followUpInput, isSubmitting, activeRunId, isRunRunning, messages, threadId, startStreaming]);

  /* ── Loading state ─────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.05] bg-white/70 px-8 py-7 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#11141b]/70"
        >
          <div className="relative">
            <Loader2 size={28} className="animate-spin text-orange-500" />
            <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {TEXT_CONFIG.runPage.loadingResearch}
          </p>
        </motion.div>
      </div>
    );
  }

  const steeringEvents = activeEvents.filter(
    (e) => e.state === 'steering_queued',
  );

  return (
    <div className="relative flex min-h-[100dvh] flex-col px-2 pb-4 pt-14 sm:px-4 sm:pt-5 lg:px-8">
      {/* Gradient background accent for running state */}
      <AnimatePresence>
        {isRunRunning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-0"
          >
            <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-orange-500/[0.04] blur-3xl sm:h-96 sm:w-96" />
            <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-amber-500/[0.04] blur-3xl sm:h-96 sm:w-96" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-4 lg:flex-row">
        {/* ── Main Chat Panel ─────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-panel flex flex-1 flex-col overflow-hidden rounded-2xl border sm:rounded-[28px]"
        >
          {/* Header */}
          <header className="flex items-center gap-2.5 border-b border-black/[0.06] px-3 py-3 dark:border-white/[0.06] sm:gap-3 sm:px-5 sm:py-4">
            <Link
              href="/"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.08] text-neutral-500 transition-all hover:bg-orange-500/10 hover:text-orange-600 hover:border-orange-500/20 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:text-orange-400 sm:h-9 sm:w-9 sm:rounded-xl"
              title={TEXT_CONFIG.runPage.backTitle}
            >
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white sm:text-base">
                {messages[0]?.content || TEXT_CONFIG.runPage.noQueryFallback}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] sm:text-xs">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${statusConfig[runStatus].className}`}
                >
                  {statusConfig[runStatus].pulse && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                  )}
                  {statusConfig[runStatus].icon}
                  {statusConfig[runStatus].label}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowTrace(!showTrace)}
              className="flex h-8 items-center gap-1 rounded-lg border border-black/[0.08] px-2 text-[10px] font-medium text-neutral-600 transition-all hover:bg-orange-500/10 hover:text-orange-600 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:text-orange-400 lg:hidden sm:h-9 sm:gap-1.5 sm:rounded-xl sm:px-3 sm:text-xs"
            >
              <Zap size={12} />
              <span className="hidden sm:inline">{TEXT_CONFIG.runPage.traceToggle}</span>
            </button>
          </header>

          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-600 dark:text-red-400 sm:mx-5 sm:text-sm">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <p className="flex-1">{error}</p>
                  <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600">
                    <XCircle size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat messages — scrollable */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-4 sm:px-5 sm:py-5 sm:space-y-5">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="ml-auto max-w-[95%] sm:max-w-[78%]"
                  >
                    <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-3.5 py-2.5 text-[13px] text-white shadow-md shadow-orange-600/15 sm:px-4 sm:py-3 sm:text-sm">
                      {msg.content}
                    </div>
                    <p className="mt-1 text-right text-[10px] text-neutral-400 dark:text-neutral-500">
                      {TEXT_CONFIG.runPage.userLabel}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="max-w-full sm:max-w-[92%]"
                  >
                    {/* Collapsible trace */}
                    <InlineTraceBlock
                      runId={msg.runId}
                      events={activeEvents}
                      activeState={activeState}
                      isActive={msg.runId === activeRunId}
                    />
                    <div className="flex gap-2.5 sm:gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <Image
                          src={botLogoSrc}
                          width={28}
                          height={28}
                          alt="Nexara"
                          className="h-6 w-6 object-contain sm:h-7 sm:w-7"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/82 px-3 py-3 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#101216]/82 sm:px-4 sm:py-4">
                          <ReportViewer
                            reportMd={msg.content}
                            citations={runResultsMap[msg.runId]?.citations ?? []}
                            sources={runResultsMap[msg.runId]?.sources ?? []}
                            evaluation={runResultsMap[msg.runId]?.evaluation ?? null}
                            isRunning={false}
                            runId={msg.runId}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                          {TEXT_CONFIG.runPage.assistantName}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            ))}

            {/* Steering events for the active run */}
            {steeringEvents.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="ml-auto max-w-[95%] sm:max-w-[78%]"
              >
                <div className="rounded-2xl rounded-tr-md border border-orange-500/25 bg-orange-500/10 px-3.5 py-2.5 text-[13px] text-orange-700 dark:text-orange-300 sm:px-4 sm:py-3 sm:text-sm">
                  {extractSteeringMessage(event)}
                </div>
                <p className="mt-1 text-right text-[10px] text-neutral-400 dark:text-neutral-500">
                  {TEXT_CONFIG.runPage.steeringUserLabel}
                </p>
              </motion.div>
            ))}

            {/* Active run thinking indicator */}
            {hasActiveRun && isRunRunning && !activeResult?.report_md && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="max-w-full sm:max-w-[92%]"
              >
                <div className="flex gap-2.5 sm:gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Image
                      src={botLogoSrc}
                      width={28}
                      height={28}
                      alt="Nexara"
                      className="h-6 w-6 object-contain animate-pulse sm:h-7 sm:w-7"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/82 px-3 py-3 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#101216]/82 sm:px-4 sm:py-4">
                      <ThinkingSkeleton activeState={activeState} />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Steering feedback */}
          {steeringFeedback && (
            <div className="px-3 pb-1 sm:px-5">
              <p className="text-[10px] text-orange-600 dark:text-orange-400 sm:text-xs">
                {steeringFeedback}
              </p>
            </div>
          )}

          {/* Input bar — always visible at bottom */}
          <div className="border-t border-black/[0.06] px-3 py-3 dark:border-white/[0.06] sm:px-5 sm:py-4">
            <div className="flex items-end gap-2">
              <textarea
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleFollowUp();
                  }
                }}
                rows={1}
                placeholder={
                  isRunRunning
                    ? TEXT_CONFIG.runPage.steeringPlaceholder
                    : 'Ask a follow-up question...'
                }
                className="min-h-[38px] max-h-[120px] flex-1 resize-none rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-xs text-neutral-800 outline-none transition-colors focus:border-orange-500/40 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-neutral-100 sm:min-h-[42px] sm:text-sm"
              />
              <button
                onClick={() => void handleFollowUp()}
                disabled={!followUpInput.trim() || isSubmitting}
                className={`flex h-[38px] w-[38px] items-center justify-center rounded-xl transition-all sm:h-[42px] sm:w-[42px] ${followUpInput.trim() && !isSubmitting
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-neutral-100 text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-600'
                  }`}
                title={isRunRunning ? 'Send steering note' : 'Send follow-up'}
              >
                {isSubmitting || isSteeringSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowUp size={15} />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-neutral-500 dark:text-neutral-400 sm:text-xs">
              {isRunRunning
                ? TEXT_CONFIG.runPage.steeringHint
                : 'Continue this research thread with a follow-up question'}
            </p>
          </div>
        </motion.section>

        {/* ── Agent Trace Sidebar (desktop) ────────────────────────── */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className={`glass-panel rounded-2xl border p-3 sm:rounded-[28px] sm:p-4 lg:sticky lg:top-5 lg:block lg:max-h-[calc(100vh-3rem)] lg:w-[340px] lg:overflow-y-auto xl:w-[360px] ${showTrace ? 'block' : 'hidden lg:block'
            }`}
        >
          <div className="mb-3 flex items-center justify-between sm:mb-4">
            <div className="flex items-center gap-2">
              <Image
                key={botLogoSrc}
                src={botLogoSrc}
                alt={TEXT_CONFIG.runPage.traceTitle}
                width={18}
                height={18}
                className="h-[16px] w-[16px] rounded-md object-cover sm:h-[18px] sm:w-[18px]"
              />
              <p className="text-xs font-semibold text-neutral-900 dark:text-white sm:text-sm">
                {TEXT_CONFIG.runPage.traceTitle}
              </p>
            </div>
            <span className="px-1 text-[10px] font-mono text-neutral-500 dark:text-neutral-400 sm:text-[11px]">
              {(activeRunId || initialRunId).slice(0, 8)}
            </span>
          </div>

          {activeEvents.length > 0 && (
            <div className="mb-3 flex items-center gap-2 px-1 text-[10px] text-neutral-500 dark:text-neutral-400 sm:text-xs">
              <span>
                {activeEvents.length} event{activeEvents.length !== 1 ? 's' : ''}{' '}
                {TEXT_CONFIG.runPage.eventsTrackedSuffix}
              </span>
              {isRunRunning && (
                <span className="relative ml-auto flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                </span>
              )}
            </div>
          )}

          <TraceTimeline events={activeEvents} activeState={activeState} />
        </motion.aside>
      </div>
    </div>
  );
}
