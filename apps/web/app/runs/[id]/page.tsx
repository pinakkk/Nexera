'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
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
  Download,
} from 'lucide-react';
import { TraceTimeline } from '@/components/TraceTimeline';
import { ReportViewer } from '@/components/ReportViewer';
import { useTheme } from '@/components/theme';
import { subscribeToRun } from '@/lib/sse';
import { getRun, getRunEvents, submitSteeringInput } from '@/lib/api';
import { RunEvent, RunResult, RunStatusValue, formatAgentStateLabel } from '@/lib/types';
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
      {/* Animated state indicator */}
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

      {/* Animated progress bars */}
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

      {/* Live step pills */}
      <div className="flex flex-wrap gap-1.5 pt-1 sm:gap-2">
        {TEXT_CONFIG.runPage.thinkingSteps.map(
          (step, i) => {
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
          }
        )}
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

/* ── Main page ───────────────────────────────────────────────────────── */

export default function RunPage() {
  const { theme } = useTheme();
  const params = useParams();
  const runId = params.id as string;
  const traceLogoSrc =
    theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png';

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatusValue>('pending');
  const [query, setQuery] = useState('');
  const [iteration, setIteration] = useState(0);
  const [maxIterations, setMaxIterations] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [steeringInput, setSteeringInput] = useState('');
  const [steeringFeedback, setSteeringFeedback] = useState<string | null>(null);
  const [isSteeringSubmitting, setIsSteeringSubmitting] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);

  const initialize = useCallback(async () => {
    try {
      const [runData, existingEvents] = await Promise.all([
        getRun(runId),
        getRunEvents(runId),
      ]);

      setQuery(runData.query);
      setStatus(runData.status);
      setIteration(runData.iteration);
      setMaxIterations(runData.max_iterations);
      setActiveState(runData.current_state);
      setEvents(existingEvents);

      const lastFailedEvent =
        [...existingEvents]
          .reverse()
          .find(
            (event) =>
              event.state.includes('fail') || event.state.includes('error')
          ) ?? null;
      if (runData.status === 'failed') {
        setError(
          extractFailureMessage(lastFailedEvent) ??
          TEXT_CONFIG.runPage.runFailedDefault
        );
      }

      if (runData.status === 'completed' || runData.status === 'failed') {
        setResult(runData);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);

      const cleanup = subscribeToRun(runId, {
        onEvent: (event: RunEvent) => {
          setEvents((prev) => {
            if (prev.some((item) => item.id === event.id)) return prev;
            return [...prev, event];
          });
          setActiveState(event.state);
          if (event.iteration > 0) setIteration(event.iteration);
          const failed =
            event.state.includes('fail') || event.state.includes('error');
          setStatus(failed ? 'failed' : 'running');
          if (failed) {
            setError(
              extractFailureMessage(event) ??
              TEXT_CONFIG.runPage.runFailedDefault
            );
          }
        },
        onComplete: (finalResult: RunResult) => {
          setResult(finalResult);
          setStatus(finalResult.status);
          setActiveState(finalResult.current_state);
          setIteration(finalResult.iteration);
          setMaxIterations(finalResult.max_iterations);
        },
        onError: (streamError: Error) => {
          console.error('[RunPage] Stream error', streamError);
          setError(streamError.message);
        },
      });

      cleanupRef.current = cleanup;
    } catch (loadError) {
      console.error('[RunPage] Initialization error', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : TEXT_CONFIG.runPage.loadFailed
      );
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void initialize();
    return () => {
      cleanupRef.current?.();
    };
  }, [initialize]);

  const badge = statusConfig[status];
  const isRunning = status === 'pending' || status === 'running';
  const steeringEvents = events.filter((event) => event.state === 'steering_queued');
  const canSubmitSteering =
    isRunning && steeringInput.trim().length > 0 && !isSteeringSubmitting;

  const handleSteeringSubmit = useCallback(async () => {
    const message = steeringInput.trim();
    if (!message || !isRunning || isSteeringSubmitting) return;

    setIsSteeringSubmitting(true);
    setSteeringFeedback(null);
    try {
      const response = await submitSteeringInput(runId, message);
      if (!response.queued) {
        setSteeringFeedback(response.message);
        return;
      }
      setSteeringInput('');
      setSteeringFeedback(TEXT_CONFIG.runPage.steeringQueuedSuccess);
    } catch (submitError) {
      setSteeringFeedback(
        submitError instanceof Error
          ? submitError.message
          : TEXT_CONFIG.runPage.steeringQueuedFailure,
      );
    } finally {
      setIsSteeringSubmitting(false);
    }
  }, [isRunning, isSteeringSubmitting, runId, steeringInput]);

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
            <Loader2
              size={28}
              className="animate-spin text-orange-500"
            />
            <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {TEXT_CONFIG.runPage.loadingResearch}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] px-2 pb-6 pt-14 sm:px-4 sm:pt-5 lg:px-8 lg:pb-8">
      {/* Gradient background accent for running state */}
      <AnimatePresence>
        {isRunning && (
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

      <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-col gap-4 lg:flex-row">
        {/* ── Main Chat Panel ─────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-panel flex min-h-[55vh] flex-1 flex-col overflow-hidden rounded-2xl border p-3 sm:min-h-[70vh] sm:rounded-[28px] sm:p-5"
        >
          {/* Header */}
          <header className="flex items-start gap-2.5 border-b border-black/[0.06] pb-3 dark:border-white/[0.06] sm:gap-3 sm:pb-4">
            <Link
              href="/"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.08] text-neutral-500 transition-all hover:bg-orange-500/10 hover:text-orange-600 hover:border-orange-500/20 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:text-orange-400 sm:h-9 sm:w-9 sm:rounded-xl"
              title={TEXT_CONFIG.runPage.backTitle}
            >
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white sm:text-base lg:text-lg">
                {query || TEXT_CONFIG.runPage.noQueryFallback}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] sm:mt-1.5 sm:gap-2 sm:text-xs">
                {/* Status badge */}
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium sm:gap-1.5 sm:px-2.5 sm:py-1 ${badge.className}`}
                >
                  {badge.pulse && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                  )}
                  {badge.icon}
                  {badge.label}
                </span>

                {/* Active state label */}
                {activeState && isRunning && (
                  <span className="text-neutral-500 dark:text-neutral-400 hidden sm:inline">
                    {formatAgentStateLabel(activeState)}
                  </span>
                )}

                {/* Iteration badge */}
                {maxIterations > 0 && (
                  <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-neutral-500 dark:bg-white/[0.05] dark:text-neutral-400 sm:px-2">
                    {TEXT_CONFIG.runPage.iterationPrefix} {iteration}/{maxIterations}
                  </span>
                )}
              </div>
            </div>

            {/* Mobile trace toggle */}
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
                className="mt-3 overflow-hidden rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-600 dark:text-red-400 sm:mt-4 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
              >
                <div className="flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0 sm:size-4" />
                  <p>{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat bubbles — scrollable, clipped */}
          <div className="mt-4 flex-1 space-y-4 overflow-y-auto overflow-x-hidden sm:mt-5 sm:space-y-5">
            {/* User message */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="ml-auto max-w-[95%] sm:max-w-[78%]"
            >
              <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-3.5 py-2.5 text-[13px] text-white shadow-md shadow-orange-600/15 sm:px-4 sm:py-3 sm:text-sm">
                {query}
              </div>
              <p className="mt-1 text-right text-[10px] text-neutral-400 dark:text-neutral-500 sm:text-[11px]">
                {TEXT_CONFIG.runPage.userLabel}
              </p>
            </motion.div>

            {/* Assistant response */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="max-w-full sm:max-w-[92%]"
            >
              <div className="rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/82 px-3 py-3 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#101216]/82 sm:px-4 sm:py-4">
                {isRunning && !result?.report_md ? (
                  <ThinkingSkeleton activeState={activeState} />
                ) : (
                  <ReportViewer
                    reportMd={result?.report_md ?? null}
                    citations={result?.citations ?? []}
                    sources={result?.sources ?? []}
                    evaluation={result?.evaluation ?? null}
                    isRunning={isRunning}
                    runId={runId}
                  />
                )}
              </div>
              <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500 sm:text-[11px]">
                {TEXT_CONFIG.runPage.assistantName}
              </p>
            </motion.div>

            {/* User steering notes */}
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
                <p className="mt-1 text-right text-[10px] text-neutral-400 dark:text-neutral-500 sm:text-[11px]">
                  {TEXT_CONFIG.runPage.steeringUserLabel}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Non-blocking steering input */}
          <AnimatePresence>
            {isRunning && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.06] sm:mt-4"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    value={steeringInput}
                    onChange={(event) => setSteeringInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void handleSteeringSubmit();
                      }
                    }}
                    rows={1}
                    placeholder={TEXT_CONFIG.runPage.steeringPlaceholder}
                    className="min-h-[38px] flex-1 resize-none rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-xs text-neutral-800 outline-none transition-colors focus:border-orange-500/40 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-neutral-100 sm:min-h-[42px] sm:text-sm"
                  />
                  <button
                    onClick={() => void handleSteeringSubmit()}
                    disabled={!canSubmitSteering}
                    className={`flex h-[38px] w-[38px] items-center justify-center rounded-xl transition-all sm:h-[42px] sm:w-[42px] ${canSubmitSteering
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'bg-neutral-100 text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-600'
                      }`}
                    title={TEXT_CONFIG.runPage.steeringSubmitTitle}
                  >
                    {isSteeringSubmitting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArrowUp size={15} />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-neutral-500 dark:text-neutral-400 sm:mt-2 sm:text-xs">
                  {TEXT_CONFIG.runPage.steeringHint}
                </p>
                {steeringFeedback && (
                  <p className="mt-1 text-[10px] text-orange-600 dark:text-orange-400 sm:text-xs">
                    {steeringFeedback}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* ── Agent Trace Sidebar ─────────────────────────────────── */}
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
                key={traceLogoSrc}
                src={traceLogoSrc}
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
              {runId.slice(0, 8)}
            </span>
          </div>

          {/* Event count badge */}
          {events.length > 0 && (
            <div className="mb-3 flex items-center gap-2 px-1 text-[10px] text-neutral-500 dark:text-neutral-400 sm:text-xs">
              <span>
                {events.length} event{events.length !== 1 ? 's' : ''}{' '}
                {TEXT_CONFIG.runPage.eventsTrackedSuffix}
              </span>
              {isRunning && (
                <span className="relative ml-auto flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                </span>
              )}
            </div>
          )}

          <TraceTimeline events={events} activeState={activeState} />
        </motion.aside>
      </div>
    </div>
  );
}
