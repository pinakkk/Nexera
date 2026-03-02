'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { TraceTimeline } from '@/components/TraceTimeline';
import { ReportViewer } from '@/components/ReportViewer';
import { subscribeToRun } from '@/lib/sse';
import { getRun, getRunEvents } from '@/lib/api';
import { RunEvent, RunResult, RunStatusValue, formatAgentStateLabel } from '@/lib/types';

const statusBadge: Record<RunStatusValue, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300',
  },
  running: {
    label: 'Running',
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-600 dark:text-red-300',
  },
};

function AssistantSkeleton({ activeState }: { activeState: string | null }) {
  return (
    <div className="space-y-3">
      <div className="h-4 w-3/4 rounded-full skeleton-shimmer" />
      <div className="h-4 w-full rounded-full skeleton-shimmer" />
      <div className="h-4 w-5/6 rounded-full skeleton-shimmer" />
      <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
        {activeState
          ? `${formatAgentStateLabel(activeState)}...`
          : 'Thinking...'}
      </p>
    </div>
  );
}

function extractFailureMessage(event: RunEvent | null): string | null {
  if (!event) return null;
  const payload = event.payload ?? null;
  if (payload) {
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors.find((item) => typeof item === 'string');
      if (typeof first === 'string' && first.trim()) {
        return first;
      }
    }
  }
  if (event.message && !event.message.startsWith('State:')) {
    return event.message;
  }
  return null;
}

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
          .find((event) => event.state.includes('fail') || event.state.includes('error')) ??
        null;
      if (runData.status === 'failed') {
        setError(
          extractFailureMessage(lastFailedEvent) ??
            'Run failed. Check Agent Trace for details.',
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
          if (event.iteration > 0) {
            setIteration(event.iteration);
          }
          const failed = event.state.includes('fail') || event.state.includes('error');
          setStatus(failed ? 'failed' : 'running');
          if (failed) {
            setError(
              extractFailureMessage(event) ??
                'Run failed. Check Agent Trace for details.',
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
        loadError instanceof Error ? loadError.message : 'Failed to load run data.',
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

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-neutral-500 dark:text-neutral-400">
          <Loader2 size={24} className="animate-spin" />
          <p className="text-sm">Loading run...</p>
        </div>
      </div>
    );
  }

  const badge = statusBadge[status];
  const isRunning = status === 'pending' || status === 'running';

  return (
    <div className="relative min-h-screen px-3 pb-8 pt-14 sm:px-6 sm:pt-5 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 lg:flex-row">
        <section className="glass-panel fade-up flex min-h-[60vh] flex-1 flex-col rounded-2xl border p-3 sm:min-h-[70vh] sm:rounded-[28px] sm:p-6">
          <header className="flex items-start gap-3 border-b border-black/10 pb-4 dark:border-white/10">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-neutral-600 transition-colors hover:bg-black/[0.04] hover:text-neutral-900 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
              title="Back"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="h-display truncate text-base font-semibold text-neutral-900 dark:text-white">
                {query || 'Research Run'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {activeState && (
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {formatAgentStateLabel(activeState)}
                  </span>
                )}
                {maxIterations > 0 && (
                  <span className="text-neutral-500 dark:text-neutral-400">
                    Iteration {iteration}/{maxIterations}
                  </span>
                )}
              </div>
            </div>
          </header>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <div className="ml-auto max-w-[95%] rounded-3xl rounded-tr-md bg-black px-3 py-2.5 text-sm text-white dark:bg-white dark:text-black sm:max-w-[80%] sm:px-4 sm:py-3">
              {query}
            </div>

            <div className="max-w-full rounded-3xl rounded-tl-md border border-black/10 bg-white/90 px-3 py-3 dark:border-white/10 dark:bg-[#101216]/90 sm:px-4 sm:py-4">
              {isRunning && !result?.report_md ? (
                <AssistantSkeleton activeState={activeState} />
              ) : (
                <ReportViewer
                  reportMd={result?.report_md ?? null}
                  citations={result?.citations ?? []}
                  sources={result?.sources ?? []}
                  evaluation={result?.evaluation ?? null}
                  isRunning={isRunning}
                />
              )}
            </div>
          </div>
        </section>

        <aside className="glass-panel fade-up rounded-2xl border p-3 sm:rounded-[28px] sm:p-5 lg:w-[360px] lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:sticky lg:top-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="h-display text-sm font-semibold text-neutral-900 dark:text-white">
              Agent Trace
            </p>
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {runId.slice(0, 8)}
            </span>
          </div>
          <TraceTimeline events={events} activeState={activeState} />
        </aside>
      </div>
    </div>
  );
}
