'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  X,
  Zap,
  Brain,
  Shield,
  Globe,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import { ResearchInput } from '@/components/ResearchInput';
import { ReportViewer } from '@/components/ReportViewer';
import { TraceTimeline } from '@/components/TraceTimeline';
import { useTheme } from '@/components/theme';
import {
  createRun,
  getRun,
  getRunEvents,
  ingestSources,
  ingestSourceUrls,
  submitSteeringInput,
} from '@/lib/api';
import { subscribeToRun } from '@/lib/sse';
import {
  RunConstraints,
  RunEvent,
  RunResult,
  RunStatusValue,
  formatAgentStateLabel,
} from '@/lib/types';
import { TEXT_CONFIG } from '@/lib/text-config';

const FEATURE_ICONS = [Zap, Brain, Shield, Globe];

export default function HomePage() {
  const { theme } = useTheme();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steeringFeedback, setSteeringFeedback] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState('');
  const [runStatus, setRunStatus] = useState<RunStatusValue>('pending');
  const [activeState, setActiveState] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);

  const streamCleanupRef = useRef<(() => void) | null>(null);

  const hasActiveRun = Boolean(activeRunId);
  const isRunRunning = runStatus === 'pending' || runStatus === 'running';
  const inResearchMode = isSubmitting || hasActiveRun;
  const heroLogoSrc =
    theme === 'dark' ? '/assets/darkhorizontal.png' : '/assets/horizontal.png';

  const handleSubmit = useCallback(
    async (
      query: string,
      constraints: RunConstraints,
      extras: { files: File[]; urls: string[] },
    ) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      if (activeRunId && isRunRunning) {
        try {
          const response = await submitSteeringInput(activeRunId, trimmed);
          if (!response.queued) {
            throw new Error(response.message);
          }
          setSteeringFeedback(TEXT_CONFIG.runPage.steeringQueuedSuccess);
          setError(null);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : TEXT_CONFIG.runPage.steeringQueuedFailure,
          );
        }
        return;
      }

      setIsSubmitting(true);
      setError(null);
      setSteeringFeedback(null);

      try {
        if (extras.files.length > 0) {
          await ingestSources(extras.files);
        }

        if (extras.urls.length > 0) {
          await ingestSourceUrls(extras.urls);
        }

        const { run_id } = await createRun(trimmed, constraints);
        setActiveRunId(run_id);
        setActiveQuery(trimmed);
        setRunStatus('pending');
        setActiveState(null);
        setEvents([]);
        setResult(null);
      } catch (err) {
        console.error('[HomePage] Failed to start run', err);
        setError(err instanceof Error ? err.message : TEXT_CONFIG.home.startFailed);
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeRunId, isRunRunning],
  );

  useEffect(() => {
    if (!activeRunId) return;
    const runId = activeRunId;

    let canceled = false;

    async function initializeLiveRun() {
      try {
        const [runData, existingEvents] = await Promise.all([
          getRun(runId),
          getRunEvents(runId),
        ]);

        if (canceled) return;

        setActiveQuery((prev) => runData.query || prev);
        setRunStatus(runData.status);
        setActiveState(runData.current_state);
        setEvents(existingEvents);

        if (runData.status === 'completed' || runData.status === 'failed') {
          setResult(runData);
          return;
        }

        streamCleanupRef.current?.();
        streamCleanupRef.current = subscribeToRun(runId, {
          onEvent: (event) => {
            setEvents((prev) => {
              if (prev.some((item) => item.id === event.id)) return prev;
              return [...prev, event];
            });
            setActiveState(event.state);
            if (event.state.includes('fail') || event.state.includes('error')) {
              setRunStatus('failed');
            } else if (event.state.includes('final')) {
              setRunStatus('completed');
            } else {
              setRunStatus('running');
            }
          },
          onComplete: (finalResult) => {
            setResult(finalResult);
            setRunStatus(finalResult.status);
            setActiveState(finalResult.current_state);
          },
          onError: (streamError) => {
            setError(streamError.message);
          },
        });
      } catch (loadError) {
        if (canceled) return;
        setError(
          loadError instanceof Error ? loadError.message : TEXT_CONFIG.runPage.loadFailed,
        );
      }
    }

    void initializeLiveRun();

    return () => {
      canceled = true;
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, [activeRunId]);

  return (
    <div className="relative min-h-screen overflow-hidden px-4 pb-10 pt-16 sm:px-6 sm:pt-16">
      <div className="pointer-events-none absolute left-1/2 top-[15%] h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/[0.08] to-amber-500/[0.04] blur-[80px] dark:from-orange-400/[0.16] dark:to-amber-400/[0.08] sm:top-[18%] sm:h-[500px] sm:w-[500px]" />
      <div className="pointer-events-none absolute right-[10%] top-[45%] h-[250px] w-[250px] rounded-full bg-gradient-to-br from-blue-500/[0.04] to-sky-500/[0.02] blur-[60px] dark:from-sky-400/[0.1] dark:to-cyan-400/[0.06] sm:h-[350px] sm:w-[350px]" />
      <div className="pointer-events-none absolute left-[5%] top-[60%] h-[200px] w-[200px] rounded-full bg-gradient-to-br from-purple-500/[0.03] to-violet-500/[0.02] blur-[50px] dark:from-violet-400/[0.08] dark:to-indigo-400/[0.05]" />

      <div
        className={clsx(
          'mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-6xl flex-col transition-all duration-500',
          inResearchMode ? 'justify-between pb-3 pt-8 sm:pb-5' : 'justify-center',
        )}
      >
        <AnimatePresence>
          {!inResearchMode && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mx-auto w-full max-w-3xl"
            >
              <div className="mb-8 flex flex-col items-center text-center">
                <Image
                  src={heroLogoSrc}
                  alt={TEXT_CONFIG.home.brandName}
                  width={280}
                  height={56}
                  className="h-auto w-[220px] object-contain drop-shadow-[0_1px_5px_rgba(251,146,60,0.14)] dark:drop-shadow-[0_1px_10px_rgba(248,250,252,0.12)] sm:w-[280px]"
                  priority
                />
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400 sm:mt-4 sm:text-base">
                  {TEXT_CONFIG.home.brandDescription}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(isSubmitting || (hasActiveRun && isRunRunning)) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="mx-auto w-full max-w-4xl text-center"
            >
              <div className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
                <Loader2 size={15} className="animate-spin text-orange-500" />
                {isSubmitting
                  ? TEXT_CONFIG.home.startingStatus
                  : TEXT_CONFIG.home.researchingStatus}
              </div>
              {activeState && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {formatAgentStateLabel(activeState)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hasActiveRun && activeRunId && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
              className="mx-auto mt-4 w-full max-w-6xl flex-1"
            >
              <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <section className="glass-panel flex min-h-[44vh] flex-col rounded-3xl border border-black/[0.06] bg-white/[0.78] p-4 shadow-[0_8px_24px_rgba(20,20,20,0.06)] dark:border-white/[0.1] dark:bg-[#0b1119]/88 dark:shadow-[0_8px_28px_rgba(0,0,0,0.34)] sm:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                        {TEXT_CONFIG.home.activeSessionTitle}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {TEXT_CONFIG.home.activeSessionSubtitle}
                      </p>
                    </div>
                    <Link
                      href={`/runs/${activeRunId}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:text-orange-600 hover:border-orange-500/30 dark:border-white/[0.1] dark:text-neutral-300 dark:hover:text-orange-400"
                    >
                      {TEXT_CONFIG.home.openRun}
                      <ExternalLink size={12} />
                    </Link>
                  </div>

                  <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-3 text-sm text-white">
                    {activeQuery}
                  </div>

                  <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-black/[0.06] bg-white/85 p-4 dark:border-white/[0.09] dark:bg-[#0e1622]/85">
                    <ReportViewer
                      reportMd={result?.report_md ?? null}
                      citations={result?.citations ?? []}
                      sources={result?.sources ?? []}
                      evaluation={result?.evaluation ?? null}
                      isRunning={isRunRunning}
                      runId={activeRunId}
                    />
                  </div>

                  {steeringFeedback && (
                    <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                      {steeringFeedback}
                    </p>
                  )}
                </section>

                <aside className="glass-panel hidden rounded-3xl border border-black/[0.06] bg-white/[0.78] p-4 shadow-[0_8px_24px_rgba(20,20,20,0.06)] dark:border-white/[0.1] dark:bg-[#0b1119]/88 dark:shadow-[0_8px_28px_rgba(0,0,0,0.34)] lg:block lg:max-h-[62vh] lg:overflow-y-auto">
                  <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-white">
                    {TEXT_CONFIG.home.traceTitle}
                  </p>
                  <TraceTimeline events={events} activeState={activeState} />
                </aside>
              </div>

              <div className="glass-panel mt-3 block rounded-2xl border border-black/[0.06] bg-white/[0.78] p-3 shadow-[0_8px_24px_rgba(20,20,20,0.06)] dark:border-white/[0.1] dark:bg-[#0b1119]/88 dark:shadow-[0_8px_28px_rgba(0,0,0,0.34)] lg:hidden">
                <p className="mb-2 text-sm font-semibold text-neutral-900 dark:text-white">
                  {TEXT_CONFIG.home.traceTitle}
                </p>
                <TraceTimeline events={events} activeState={activeState} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout
          transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
          className={clsx(
            'w-full self-center',
            hasActiveRun ? 'max-w-4xl pt-4' : 'max-w-3xl mt-8',
          )}
        >
          <ResearchInput onSubmit={handleSubmit} isLoading={isSubmitting} />
        </motion.div>

        <AnimatePresence>
          {!inResearchMode && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
              className="mx-auto mt-6 w-full max-w-3xl"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
              >
                {TEXT_CONFIG.home.features.map((feat, i) => {
                  const Icon = FEATURE_ICONS[i] ?? Zap;
                  return (
                    <motion.div
                      key={feat.title}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
                      className="flex items-center gap-2.5 rounded-xl glass-panel-solid px-3.5 py-3"
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className="shrink-0 text-orange-500/80"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                          {feat.title}
                        </p>
                        <p className="truncate text-[10px] text-neutral-500 dark:text-neutral-400">
                          {feat.desc}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 w-full max-w-4xl self-center flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
