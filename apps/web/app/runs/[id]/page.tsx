'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
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
import { subscribeToRun } from '@/lib/sse';
import { getRun, getRunEvents } from '@/lib/api';
import { RunEvent, RunResult, RunStatusValue, formatAgentStateLabel } from '@/lib/types';

/* ── Status badge configs ────────────────────────────────────────────── */

const statusConfig: Record<
  RunStatusValue,
  { label: string; icon: React.ReactNode; className: string; pulse?: boolean }
> = {
  pending: {
    label: 'Queued',
    icon: <Clock size={13} />,
    className:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    pulse: true,
  },
  running: {
    label: 'Researching',
    icon: <Zap size={13} />,
    className:
      'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
    pulse: true,
  },
  completed: {
    label: 'Completed',
    icon: <CheckCircle2 size={13} />,
    className:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  failed: {
    label: 'Failed',
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
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20"
        >
          {stateIcon(activeState)}
        </motion.div>
        <div>
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {activeState
              ? formatAgentStateLabel(activeState)
              : 'Initializing research...'}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Nexara is working on your query
          </p>
        </div>
      </div>

      {/* Animated progress bars */}
      <div className="space-y-2.5 py-1">
        {[0.85, 1, 0.7, 0.9].map((w, i) => (
          <motion.div
            key={i}
            className="h-3 rounded-full bg-gradient-to-r from-neutral-200/60 via-neutral-100/80 to-neutral-200/60 dark:from-white/[0.06] dark:via-white/[0.12] dark:to-white/[0.06]"
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
      <div className="flex flex-wrap gap-2 pt-1">
        {['Planning', 'Searching', 'Analyzing', 'Synthesizing'].map(
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
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${isActive
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

/* ── Main page ───────────────────────────────────────────────────────── */

export default function RunPage() {
  const params = useParams();
  const runId = params.id as string;

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatusValue>('pending');
  const [query, setQuery] = useState('');
  const [iteration, setIteration] = useState(0);
  const [maxIterations, setMaxIterations] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTrace, setShowTrace] = useState(false);

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
          'Run failed. Check Agent Trace for details.'
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
              'Run failed. Check Agent Trace for details.'
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
          : 'Failed to load run data.'
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

  /* ── Loading state ─────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <Loader2
              size={28}
              className="animate-spin text-orange-500"
            />
            <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Loading research...
          </p>
        </motion.div>
      </div>
    );
  }

  const badge = statusConfig[status];
  const isRunning = status === 'pending' || status === 'running';

  return (
    <div className="relative min-h-screen px-3 pb-8 pt-14 sm:px-5 sm:pt-5 lg:px-8">
      {/* Gradient background accent for running state */}
      <AnimatePresence>
        {isRunning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-0"
          >
            <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-orange-500/[0.04] blur-3xl" />
            <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-amber-500/[0.04] blur-3xl" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-col gap-4 lg:flex-row">
        {/* ── Main Chat Panel ─────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-panel flex min-h-[60vh] flex-1 flex-col rounded-2xl border p-3 sm:min-h-[70vh] sm:rounded-[28px] sm:p-5 overflow-hidden"
        >
          {/* Header */}
          <header className="flex items-start gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
            <Link
              href="/"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] text-neutral-500 transition-all hover:bg-orange-500/10 hover:text-orange-600 hover:border-orange-500/20 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:text-orange-400"
              title="Back"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-neutral-900 dark:text-white sm:text-lg">
                {query || 'Research Run'}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                {/* Status badge */}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${badge.className}`}
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
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {formatAgentStateLabel(activeState)}
                  </span>
                )}

                {/* Iteration badge */}
                {maxIterations > 0 && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500 dark:bg-white/[0.05] dark:text-neutral-400">
                    Iteration {iteration}/{maxIterations}
                  </span>
                )}
              </div>
            </div>

            {/* Mobile trace toggle */}
            <button
              onClick={() => setShowTrace(!showTrace)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-xs font-medium text-neutral-600 transition-all hover:bg-orange-500/10 hover:text-orange-600 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:text-orange-400 lg:hidden"
            >
              <Zap size={13} />
              Trace
            </button>
          </header>

          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-600 dark:text-red-400"
              >
                <div className="flex items-start gap-2">
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat bubbles — scrollable, clipped */}
          <div className="mt-5 flex-1 space-y-4 overflow-y-auto overflow-x-hidden">
            {/* User message */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="ml-auto max-w-[92%] sm:max-w-[78%]"
            >
              <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-3 text-sm text-white shadow-lg shadow-orange-600/15">
                {query}
              </div>
              <p className="mt-1 text-right text-[11px] text-neutral-400 dark:text-neutral-500">
                You
              </p>
            </motion.div>

            {/* Assistant response */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="max-w-full sm:max-w-[92%]"
            >
              <div className="rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/80 px-4 py-4 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#101216]/80 overflow-hidden">
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
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                <Sparkles size={10} className="mr-1 inline text-orange-500" />
                Nexara
              </p>
            </motion.div>
          </div>
        </motion.section>

        {/* ── Agent Trace Sidebar ─────────────────────────────────── */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className={`glass-panel rounded-2xl border p-3 sm:rounded-[28px] sm:p-5 lg:block lg:w-[360px] lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:sticky lg:top-5 ${showTrace ? 'block' : 'hidden lg:block'
            }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/15 to-amber-500/15">
                <Zap size={13} className="text-orange-500" />
              </div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                Agent Trace
              </p>
            </div>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono text-neutral-500 dark:bg-white/[0.05] dark:text-neutral-400">
              {runId.slice(0, 8)}
            </span>
          </div>

          {/* Event count badge */}
          {events.length > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-black/[0.04] bg-neutral-50 px-3 py-2 dark:border-white/[0.04] dark:bg-white/[0.02]">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {events.length} event{events.length !== 1 ? 's' : ''} tracked
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
