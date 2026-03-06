'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  X,
  ExternalLink,
  AlertCircle,
  Sun,
  Moon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@clerk/nextjs';
import { ResearchInput } from '@/components/ResearchInput';
import { ReportViewer } from '@/components/ReportViewer';
import { TraceTimeline } from '@/components/TraceTimeline';
import { useTheme } from '@/components/theme';
import {
  createRun,
  getRun,
  getRunEvents,
  getUserApiKeys,
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

/* ------------------------------------------------------------------ */
/*  Chat message types                                                 */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'steering';
  content: string;
  runId?: string;
  timestamp: Date;
}

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const { isSignedIn } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusValue>('pending');
  const [activeState, setActiveState] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);

  // Per-run results map: stores results/events for completed runs so they persist
  // when a new run starts in the same session
  const [runResultsMap, setRunResultsMap] = useState<Record<string, RunResult>>({});
  const [runEventsMap, setRunEventsMap] = useState<Record<string, RunEvent[]>>({});

  // Chat history
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [heroReady, setHeroReady] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const streamCleanupRef = useRef<(() => void) | null>(null);

  const hasActiveRun = Boolean(activeRunId);
  const isRunRunning = runStatus === 'pending' || runStatus === 'running';
  const inChatMode = messages.length > 0;
  const heroLogoSrc =
    theme === 'dark' ? '/assets/darkhorizontal.png' : '/assets/horizontal.png';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, result, isRunRunning]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHeroReady(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSubmit = useCallback(
    async (
      query: string,
      constraints: RunConstraints,
      extras: { files: File[]; urls: string[] },
    ) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      // If a run is active and running, submit as steering
      if (activeRunId && isRunRunning) {
        try {
          const response = await submitSteeringInput(activeRunId, trimmed);
          if (!response.queued) {
            throw new Error(response.message);
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `steering-${Date.now()}`,
              role: 'steering',
              content: trimmed,
              timestamp: new Date(),
            },
          ]);
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

      // Add user message to chat
      const userMsgId = `user-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          content: trimmed,
          timestamp: new Date(),
        },
      ]);

      // Check if Groq API key is configured
      const keys = getUserApiKeys();
      if (!keys.groqApiKey?.trim()) {
        setError('Please configure your Groq API Key in Settings before starting research.');
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        if (extras.files.length > 0) {
          await ingestSources(extras.files);
        }
        if (extras.urls.length > 0) {
          await ingestSourceUrls(extras.urls);
        }

        const { run_id } = await createRun(trimmed, constraints);

        // Save previous run's data before starting new one
        if (activeRunId && result) {
          setRunResultsMap((prev) => ({ ...prev, [activeRunId]: result }));
        }
        if (activeRunId && events.length > 0) {
          setRunEventsMap((prev) => ({ ...prev, [activeRunId]: events }));
        }

        setActiveRunId(run_id);
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
    [activeRunId, isRunRunning, events, result],
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

        setRunStatus(runData.status);
        setActiveState(runData.current_state);
        setEvents(existingEvents);

        if (runData.status === 'completed' || runData.status === 'failed') {
          setResult(runData);
          setRunResultsMap((prev) => ({ ...prev, [runId]: runData }));
          setRunEventsMap((prev) => ({ ...prev, [runId]: existingEvents }));
          // Add assistant response to chat
          if (runData.report_md) {
            setMessages((prev) => {
              if (prev.some((m) => m.runId === runId && m.role === 'assistant')) return prev;
              return [
                ...prev,
                {
                  id: `assistant-${runId}`,
                  role: 'assistant',
                  content: runData.report_md || '',
                  runId,
                  timestamp: new Date(),
                },
              ];
            });
          }
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
            // Store in per-run map for persistence across session
            setRunResultsMap((prev) => ({ ...prev, [runId]: finalResult }));
            // Add assistant response to chat
            if (finalResult.report_md) {
              setMessages((prev) => {
                if (prev.some((m) => m.runId === runId && m.role === 'assistant')) return prev;
                return [
                  ...prev,
                  {
                    id: `assistant-${runId}`,
                    role: 'assistant',
                    content: finalResult.report_md || '',
                    runId,
                    timestamp: new Date(),
                  },
                ];
              });
            }
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
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Dark Mode Toggle */}
      <div className="absolute right-3 top-3 z-50 sm:right-5 sm:top-5">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="group flex h-9 w-9 items-center justify-center rounded-full bg-white/50 border border-black/[0.06] shadow-sm backdrop-blur-xl transition-all hover:bg-white/80 dark:border-white/[0.08] dark:bg-[#0a0c12]/50 dark:hover:bg-[#0a0c12]/80 hover:scale-105 sm:h-10 sm:w-10"
        >
          {theme === 'dark' ? (
            <Sun size={16} strokeWidth={1.75} className="text-amber-500 transition-transform duration-300 group-hover:rotate-45 sm:size-[18px]" />
          ) : (
            <Moon size={16} strokeWidth={1.75} className="text-slate-600 transition-transform duration-300 group-hover:-rotate-12 sm:size-[18px]" />
          )}
        </button>
      </div>

      {/* Background gradients */}
      <div className="pointer-events-none absolute left-1/2 top-[15%] h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/[0.08] to-amber-500/[0.04] blur-[80px] dark:from-orange-400/[0.16] dark:to-amber-400/[0.08] sm:top-[18%] sm:h-[500px] sm:w-[500px]" />
      <div className="pointer-events-none absolute right-[5%] top-[45%] h-[200px] w-[200px] rounded-full bg-gradient-to-br from-blue-500/[0.04] to-sky-500/[0.02] blur-[60px] dark:from-sky-400/[0.1] dark:to-cyan-400/[0.06] sm:h-[350px] sm:w-[350px]" />

      {/* Main content area */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={clsx(
          'mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 pb-4 sm:px-6',
          inChatMode ? 'pt-4 sm:pt-6' : 'justify-center pt-12 sm:pt-16',
        )}
      >
        {/* Hero section — only when no messages */}
        <AnimatePresence>
          {!inChatMode && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="mx-auto w-full max-w-3xl"
            >
              <div className="mb-6 flex flex-col items-center text-center sm:mb-8">
                <Image
                  src={heroLogoSrc}
                  alt={TEXT_CONFIG.home.brandName}
                  width={280}
                  height={56}
                  className={clsx(
                    'h-auto w-[180px] object-contain drop-shadow-[0_1px_5px_rgba(251,146,60,0.14)] transition-all duration-500 dark:drop-shadow-[0_1px_10px_rgba(248,250,252,0.12)] sm:w-[280px]',
                    heroReady ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-1 opacity-0 blur-[2px]',
                  )}
                  priority
                />
                <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-600 dark:text-neutral-400 sm:mt-4 sm:max-w-xl sm:text-base">
                  {TEXT_CONFIG.home.brandDescription}
                </p>
                {!isSignedIn && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2 text-xs font-medium text-orange-600 dark:text-orange-400 sm:mt-5 sm:px-4 sm:py-2.5 sm:text-sm">
                    <AlertCircle size={14} className="text-orange-500 shrink-0 sm:size-4" />
                    <span>
                      You are exploring anonymously.{' '}
                      <Link href="/sign-in" className="font-bold underline hover:text-orange-700 dark:hover:text-orange-300">
                        Sign in to save your chats
                      </Link>
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat messages area */}
        {inChatMode && (
          <div className="flex-1 overflow-y-auto overflow-x-hidden w-full mb-4 space-y-1 pb-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={clsx(
                  'flex w-full gap-2.5 px-1 py-3 sm:gap-3 sm:px-4 sm:py-4 animate-fade-in-fast',
                  msg.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                {/* Assistant / steering avatar */}
                {msg.role !== 'user' && (
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-transparent sm:h-8 sm:w-8 sm:rounded-xl">
                      <Image
                        src={theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png'}
                        width={28}
                        height={28}
                        alt="Bot"
                        className={clsx(
                          'h-6 w-6 drop-shadow-[0_1px_3px_rgba(251,146,60,0.2)] dark:drop-shadow-[0_1px_4px_rgba(248,250,252,0.15)] object-contain transition-opacity sm:h-7 sm:w-7',
                          msg.role === 'steering' && 'opacity-70 saturate-50'
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Message content */}
                <div
                  className={clsx(
                    'w-full max-w-[calc(100%-2rem)] sm:max-w-[85%] min-w-0 overflow-x-hidden',
                    msg.role === 'user' && 'order-first flex justify-end',
                  )}
                >
                  {msg.role === 'user' ? (
                    <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-3.5 py-2.5 text-[13px] text-white shadow-md shadow-orange-600/10 leading-relaxed inline-block break-words max-w-full sm:px-4 sm:py-3 sm:text-sm">
                      {msg.content}
                    </div>
                  ) : msg.role === 'steering' ? (
                    <div className="rounded-2xl rounded-tl-md border border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] px-3.5 py-2.5 text-[13px] text-amber-800 dark:text-amber-300 leading-relaxed sm:px-4 sm:py-3 sm:text-sm">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-1 sm:text-[10px]">
                        Steering Note
                      </span>
                      {msg.content}
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-2">
                      {/* Trace view for completed run inline */}
                      {msg.runId && (msg.runId === activeRunId ? events : runEventsMap[msg.runId] ?? []).length > 0 && (
                        <details className="group rounded-2xl rounded-tl-md border border-emerald-500/20 bg-emerald-50/80 dark:bg-emerald-500/[0.06] shadow-sm overflow-hidden block">
                          <summary className="flex items-center gap-2.5 cursor-pointer px-3 py-2.5 select-none hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors sm:px-4 sm:py-3 sm:gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 sm:w-2 sm:h-2" />
                            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-100 flex-1 truncate sm:text-sm">
                              Researched
                            </p>
                            <svg className="w-3.5 h-3.5 text-emerald-600/50 dark:text-emerald-400/50 transition-transform group-open:rotate-180 shrink-0 ml-1 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </summary>
                          <div className="px-3 py-3 border-t border-emerald-500/10 bg-white/60 dark:bg-[#0c1220]/60 max-h-[40vh] overflow-y-auto sm:px-4 sm:py-4 sm:max-h-[50vh]">
                            <TraceTimeline events={msg.runId === activeRunId ? events : runEventsMap[msg.runId] ?? []} activeState={activeState} />
                          </div>
                        </details>
                      )}

                      <div className="rounded-2xl rounded-tl-md border border-black/[0.06] dark:border-white/[0.06] bg-white/80 dark:bg-[#0c1220]/80 p-3 shadow-sm w-full min-w-0 overflow-hidden break-words sm:p-4">
                        <ReportViewer
                          reportMd={msg.content}
                          citations={(msg.runId ? (runResultsMap[msg.runId] ?? result) : result)?.citations ?? []}
                          sources={(msg.runId ? (runResultsMap[msg.runId] ?? result) : result)?.sources ?? []}
                          evaluation={(msg.runId ? (runResultsMap[msg.runId] ?? result) : result)?.evaluation ?? null}
                          isRunning={false}
                          runId={msg.runId ?? undefined}
                        />
                        {msg.runId && (
                          <div className="mt-2.5 pt-2.5 border-t border-black/[0.05] dark:border-white/[0.05] sm:mt-3 sm:pt-3">
                            <Link
                              href={`/runs/${msg.runId}`}
                              className="inline-flex items-center gap-1.5 text-[10px] font-medium text-neutral-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors sm:text-[11px]"
                            >
                              View full run details
                              <ExternalLink size={10} />
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            ))}

            {/* Active run status indicator (inline in chat) */}
            {(isSubmitting || (hasActiveRun && isRunRunning)) && (
                <div
                  className="flex w-full gap-2.5 px-1 py-3 sm:gap-3 sm:px-4 sm:py-4 justify-start animate-fade-in-fast"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-transparent sm:h-8 sm:w-8 sm:rounded-xl">
                      <Image
                        src={theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png'}
                        width={28}
                        height={28}
                        alt="Bot"
                        className="h-6 w-6 drop-shadow-[0_1px_3px_rgba(251,146,60,0.2)] dark:drop-shadow-[0_1px_4px_rgba(248,250,252,0.15)] object-contain animate-pulse sm:h-7 sm:w-7"
                      />
                    </div>
                  </div>

                  <div className="w-full max-w-[calc(100%-2rem)] sm:max-w-[85%] min-w-0 overflow-x-hidden">
                    <details open className="group rounded-2xl rounded-tl-md border border-orange-500/20 bg-orange-50/80 dark:bg-orange-500/[0.08] shadow-sm overflow-hidden block">
                      <summary className="flex items-center gap-2.5 cursor-pointer px-3 py-2.5 select-none hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors sm:px-4 sm:py-3 sm:gap-3">
                        <Loader2 size={14} className="animate-spin text-orange-500 shrink-0 sm:size-4" />
                        <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 flex-1 truncate sm:text-sm">
                          {isSubmitting
                            ? TEXT_CONFIG.home.startingStatus
                            : activeState ? formatAgentStateLabel(activeState) : TEXT_CONFIG.home.researchingStatus}
                        </p>
                        <svg className="w-3.5 h-3.5 text-neutral-400 transition-transform group-open:rotate-180 shrink-0 ml-1 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </summary>
                      {events.length > 0 && (
                        <div className="px-3 py-3 border-t border-orange-500/10 bg-white/60 dark:bg-[#0c1220]/60 max-h-[40vh] overflow-y-auto sm:px-4 sm:py-4 sm:max-h-[50vh]">
                          <TraceTimeline events={events} activeState={activeState} />
                        </div>
                      )}
                    </details>
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Input bar — always at bottom */}
        <div
          className={clsx(
            'w-full self-center transition-all duration-200',
            inChatMode ? 'max-w-4xl pt-2' : 'max-w-3xl mt-6 sm:mt-8',
          )}
        >
          <ResearchInput onSubmit={handleSubmit} isLoading={isSubmitting} />
        </div>

        {/* Error toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 w-full max-w-4xl self-center flex items-start gap-2.5 rounded-2xl border border-red-500/20 bg-red-50 dark:bg-red-500/[0.08] px-3 py-2.5 text-xs text-red-700 dark:text-red-300 sm:mt-4 sm:gap-3 sm:px-4 sm:py-3 sm:text-sm"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500 sm:size-4" />
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
      </motion.div>
    </div>
  );
}
