'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { ResearchInput } from '@/components/ResearchInput';
import { ReportViewer } from '@/components/ReportViewer';
import { ReasoningDisclosure } from '@/components/ReasoningDisclosure';
import { useTheme } from '@/components/theme';
import {
  createRun,
  getRun,
  getRunEvents,
  getThreadRuns,
  getUserApiKeys,
  ingestSources,
  ingestSourceUrls,
  submitSteeringInput,
} from '@/lib/api';
import { buildRecentChatHistory } from '@/lib/context';
import { subscribeToRun } from '@/lib/sse';
import {
  RunConstraints,
  RunEvent,
  RunResult,
  RunStatusValue,
  formatAgentStateLabel,
} from '@/lib/types';
import { TEXT_CONFIG } from '@/lib/text-config';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'steering';
  content: string;
  runId?: string;
  timestamp: Date;
}

function ThinkingBody({ activeState }: { activeState: string | null }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {activeState ? formatAgentStateLabel(activeState) : 'Thinking through your request'}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Nexara will answer here and keep the reasoning available above.
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 120, 240].map((delay) => (
          <span
            key={delay}
            className="h-2 w-2 animate-bounce rounded-full bg-orange-500/70"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function getLatestContinueRunId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('continue');
}

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const isSignedIn = !!user;

  const [threadId, setThreadId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusValue>('pending');
  const [activeState, setActiveState] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);

  const [runResultsMap, setRunResultsMap] = useState<Record<string, RunResult>>({});
  const [runEventsMap, setRunEventsMap] = useState<Record<string, RunEvent[]>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [heroReady, setHeroReady] = useState(false);
  const [memorySessionCount, setMemorySessionCount] = useState(0);
  const [memoryBannerDismissed, setMemoryBannerDismissed] = useState(false);

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const hasActiveRun = Boolean(activeRunId);
  const isRunRunning = runStatus === 'pending' || runStatus === 'running';
  const inChatMode = messages.length > 0;
  const heroLogoSrc =
    theme === 'dark' ? '/assets/darkhorizontal.png' : '/assets/horizontal.png';

  useEffect(() => {
    const timer = window.setTimeout(() => setHeroReady(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const memoryEvents = events.filter(
      (event) =>
        event.state.includes('memory') ||
        event.message?.toLowerCase().includes('memory') ||
        event.message?.toLowerCase().includes('previous session'),
    );

    if (memoryEvents.length === 0) {
      setMemorySessionCount(0);
      return;
    }

    const countEvent = memoryEvents.find((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      return typeof payload?.session_count === 'number' || typeof payload?.memory_count === 'number';
    });
    const payload = countEvent?.payload as Record<string, unknown> | null;
    const count =
      (payload?.session_count as number) ||
      (payload?.memory_count as number) ||
      memoryEvents.length;
    setMemorySessionCount(count);
  }, [events]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunRunning]);

  const appendAssistantMessage = useCallback((runId: string, content: string, timestamp?: string) => {
    setMessages((prev) => {
      if (prev.some((message) => message.runId === runId && message.role === 'assistant')) {
        return prev;
      }

      return [
        ...prev,
        {
          id: `assistant-${runId}`,
          role: 'assistant',
          content,
          runId,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
        },
      ];
    });
  }, []);

  const loadEventsForRun = useCallback(async (runId: string) => {
    if (runEventsMap[runId]) return;
    try {
      const fetchedEvents = await getRunEvents(runId);
      setRunEventsMap((prev) => ({ ...prev, [runId]: fetchedEvents }));
    } catch {
      setRunEventsMap((prev) => ({ ...prev, [runId]: [] }));
    }
  }, [runEventsMap]);

  const startStreaming = useCallback((runId: string) => {
    streamCleanupRef.current?.();

    streamCleanupRef.current = subscribeToRun(runId, {
      onEvent: (event) => {
        setEvents((prev) => {
          if (prev.some((item) => item.id === event.id)) return prev;
          const next = [...prev, event];
          setRunEventsMap((map) => ({ ...map, [runId]: next }));
          return next;
        });

        setActiveState(event.state);
        setRunStatus(
          event.state.includes('fail') || event.state.includes('error')
            ? 'failed'
            : 'running',
        );
      },
      onComplete: (finalResult) => {
        setRunStatus(finalResult.status);
        setActiveState(finalResult.current_state);
        setRunResultsMap((prev) => ({ ...prev, [runId]: finalResult }));
        appendAssistantMessage(runId, finalResult.report_md || '', finalResult.updated_at);
      },
      onError: (streamError) => {
        setError(streamError.message);
      },
    });
  }, [appendAssistantMessage]);

  const loadThread = useCallback(async (runId: string) => {
    setIsThreadLoading(true);
    setError(null);

    try {
      const initialRun = await getRun(runId);
      const resolvedThreadId = initialRun.thread_id || initialRun.run_id;

      let threadRuns: RunResult[];
      try {
        threadRuns = await getThreadRuns(resolvedThreadId);
      } catch {
        threadRuns = [initialRun];
      }

      threadRuns.sort(
        (left, right) =>
          new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      );

      const nextMessages: ChatMessage[] = [];
      const nextResults: Record<string, RunResult> = {};

      for (const run of threadRuns) {
        nextMessages.push({
          id: `user-${run.run_id}`,
          role: 'user',
          content: run.query,
          runId: run.run_id,
          timestamp: new Date(run.created_at),
        });

        nextResults[run.run_id] = run;

        if (run.report_md) {
          nextMessages.push({
            id: `assistant-${run.run_id}`,
            role: 'assistant',
            content: run.report_md,
            runId: run.run_id,
            timestamp: new Date(run.updated_at),
          });
        }
      }

      setThreadId(resolvedThreadId);
      setMessages(nextMessages);
      setRunResultsMap(nextResults);
      setRunEventsMap({});
      setMemoryBannerDismissed(false);

      const latestRun = threadRuns[threadRuns.length - 1];
      if (latestRun && (latestRun.status === 'pending' || latestRun.status === 'running')) {
        const existingEvents = await getRunEvents(latestRun.run_id);
        setActiveRunId(latestRun.run_id);
        setRunStatus(latestRun.status);
        setActiveState(latestRun.current_state);
        setEvents(existingEvents);
        setRunEventsMap((prev) => ({ ...prev, [latestRun.run_id]: existingEvents }));
        startStreaming(latestRun.run_id);
      } else {
        setActiveRunId(null);
        setRunStatus(latestRun?.status ?? 'completed');
        setActiveState(null);
        setEvents([]);
      }

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/');
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : TEXT_CONFIG.runPage.loadFailed,
      );
    } finally {
      setIsThreadLoading(false);
    }
  }, [startStreaming]);

  useEffect(() => {
    const continueRunId = getLatestContinueRunId();
    if (!continueRunId) return;
    void loadThread(continueRunId);
  }, [loadThread]);

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
          if (!response.queued) throw new Error(response.message);

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
        } catch (submitError) {
          setError(
            submitError instanceof Error
              ? submitError.message
              : TEXT_CONFIG.runPage.steeringQueuedFailure,
          );
        }
        return;
      }

      const keys = getUserApiKeys();
      if (!keys.groqApiKey?.trim()) {
        setError('Please configure your Groq API Key in Settings before starting research.');
        return;
      }

      const userMessageId = `user-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          content: trimmed,
          timestamp: new Date(),
        },
      ]);

      setIsSubmitting(true);
      setError(null);

      try {
        const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
        const imageFiles = extras.files.filter((file) => {
          const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
          return imageExts.has(ext);
        });
        const nonImageFiles = extras.files.filter((file) => {
          const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
          return !imageExts.has(ext);
        });

        let enrichedQuery = trimmed;
        if (imageFiles.length > 0) {
          try {
            const { analyzeImage } = await import('@/lib/api');
            const analyses = await Promise.all(
              imageFiles.map((img) =>
                analyzeImage(img, trimmed || 'Describe this image in detail.'),
              ),
            );

            const imageContext = analyses
              .map(
                (analysis, index) =>
                  `[Image ${index + 1} Analysis (${imageFiles[index].name})]\n${analysis.analysis}`,
              )
              .join('\n\n');

            enrichedQuery = `${trimmed}\n\n--- Image Analysis Context ---\n${imageContext}`;
          } catch (imageError) {
            console.error('Image analysis failed, continuing with text-only query', imageError);
          }
        }

        if (nonImageFiles.length > 0) {
          await ingestSources(nonImageFiles);
        }
        if (extras.urls.length > 0) {
          await ingestSourceUrls(extras.urls);
        }

        if (!constraints.chat_history || constraints.chat_history.length === 0) {
          constraints.chat_history = buildRecentChatHistory(messages);
        }

        const { run_id, thread_id } = await createRun(
          enrichedQuery,
          constraints,
          threadId || undefined,
        );

        setThreadId(thread_id);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === userMessageId ? { ...message, runId: run_id } : message,
          ),
        );
        setActiveRunId(run_id);
        setRunStatus('pending');
        setActiveState(null);
        setEvents([]);
        setRunEventsMap((prev) => ({ ...prev, [run_id]: [] }));
        startStreaming(run_id);
      } catch (submitError) {
        console.error('[HomePage] Failed to start run', submitError);
        setError(
          submitError instanceof Error
            ? submitError.message
            : TEXT_CONFIG.home.startFailed,
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeRunId, isRunRunning, messages, startStreaming, threadId],
  );

  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, []);

  if (isThreadLoading && !inChatMode) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.05] bg-white/70 px-8 py-7 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#11141b]/70">
          <Loader2 size={28} className="animate-spin text-orange-500" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Loading your chat…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="absolute right-3 top-3 z-50 sm:right-5 sm:top-5">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="group flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.06] bg-white/50 shadow-sm backdrop-blur-xl transition-all hover:scale-105 hover:bg-white/80 dark:border-white/[0.08] dark:bg-[#0a0c12]/50 dark:hover:bg-[#0a0c12]/80 sm:h-10 sm:w-10"
        >
          {theme === 'dark' ? (
            <Sun size={16} strokeWidth={1.75} className="text-amber-500 transition-transform duration-300 group-hover:rotate-45 sm:size-[18px]" />
          ) : (
            <Moon size={16} strokeWidth={1.75} className="text-slate-600 transition-transform duration-300 group-hover:-rotate-12 sm:size-[18px]" />
          )}
        </button>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-[15%] h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/[0.08] to-amber-500/[0.04] blur-[80px] dark:from-orange-400/[0.16] dark:to-amber-400/[0.08] sm:top-[18%] sm:h-[500px] sm:w-[500px]" />
      <div className="pointer-events-none absolute right-[5%] top-[45%] h-[200px] w-[200px] rounded-full bg-gradient-to-br from-blue-500/[0.04] to-sky-500/[0.02] blur-[60px] dark:from-sky-400/[0.1] dark:to-cyan-400/[0.06] sm:h-[350px] sm:w-[350px]" />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={clsx(
          'mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 pb-4 sm:px-6',
          inChatMode ? 'pt-4 sm:pt-6' : 'justify-center pt-12 sm:pt-16',
        )}
      >
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
                    <AlertCircle size={14} className="shrink-0 text-orange-500 sm:size-4" />
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

        {inChatMode && memorySessionCount > 0 && !memoryBannerDismissed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mx-auto mb-3 flex w-full max-w-4xl items-center gap-2.5 rounded-2xl border border-violet-500/20 bg-violet-50/80 px-4 py-2.5 text-sm text-violet-700 dark:bg-violet-500/[0.08] dark:text-violet-300"
          >
            <span className="text-base">&#129504;</span>
            <span className="flex-1">
              Agent is using insights from {memorySessionCount} previous research session{memorySessionCount !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setMemoryBannerDismissed(true)}
              className="shrink-0 text-violet-400 hover:text-violet-600 dark:hover:text-violet-200"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}

        {inChatMode && (
          <div className="mb-4 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pb-4">
            {messages.map((message) => {
              const runResult = message.runId ? runResultsMap[message.runId] : undefined;
              const messageEvents =
                message.runId === activeRunId ? events : (message.runId ? (runEventsMap[message.runId] ?? []) : []);
              const isActiveMessage = message.runId === activeRunId && isRunRunning;

              return (
                <div
                  key={message.id}
                  className={clsx(
                    'flex w-full gap-2.5 px-1 py-3 sm:gap-3 sm:px-4 sm:py-4 animate-fade-in-fast',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  {message.role !== 'user' && (
                    <div className="mt-0.5 flex-shrink-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-transparent sm:h-8 sm:w-8 sm:rounded-xl">
                        <Image
                          src={theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png'}
                          width={28}
                          height={28}
                          alt="Bot"
                          className={clsx(
                            'h-6 w-6 object-contain transition-opacity sm:h-7 sm:w-7',
                            message.role === 'steering' && 'opacity-70 saturate-50',
                          )}
                        />
                      </div>
                    </div>
                  )}

                  <div
                    className={clsx(
                      'w-full min-w-0 max-w-[calc(100%-2rem)] overflow-x-hidden sm:max-w-[85%]',
                      message.role === 'user' && 'order-first flex justify-end',
                    )}
                  >
                    {message.role === 'user' ? (
                      <div className="inline-block max-w-full break-words rounded-2xl rounded-tr-md bg-gradient-to-r from-orange-600 to-orange-500 px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-md shadow-orange-600/10 sm:px-4 sm:py-3 sm:text-sm">
                        {message.content}
                      </div>
                    ) : message.role === 'steering' ? (
                      <div className="rounded-2xl rounded-tl-md border border-amber-500/20 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-800 dark:bg-amber-500/[0.06] dark:text-amber-300 sm:px-4 sm:py-3 sm:text-sm">
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 sm:text-[10px]">
                          Steering Note
                        </span>
                        {message.content}
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-[24px] border border-black/[0.06] bg-white/82 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#0c1220]/82">
                        {message.runId && (
                          <div className="border-b border-black/[0.05] dark:border-white/[0.05]">
                            <ReasoningDisclosure
                              runId={message.runId}
                              events={messageEvents}
                              activeState={isActiveMessage ? activeState : null}
                              gateRoute={runResult?.gate_route ?? null}
                              sourcesCount={runResult?.sources.length ?? 0}
                              isRunning={isActiveMessage}
                              onLoadEvents={loadEventsForRun}
                            />
                          </div>
                        )}

                        <div className="p-3 sm:p-4">
                          <ReportViewer
                            reportMd={message.content}
                            citations={runResult?.citations ?? []}
                            sources={runResult?.sources ?? []}
                            evaluation={runResult?.evaluation ?? null}
                            isRunning={false}
                            runId={message.runId}
                          />
                          {message.runId && (
                            <div className="mt-3 border-t border-black/[0.05] pt-3 dark:border-white/[0.05]">
                              <Link
                                href={`/runs/${message.runId}`}
                                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:text-orange-600 dark:hover:text-orange-400"
                              >
                                View details
                                <ExternalLink size={10} />
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {(isSubmitting || (hasActiveRun && isRunRunning)) && activeRunId && (
              <div className="flex w-full justify-start gap-2.5 px-1 py-3 sm:gap-3 sm:px-4 sm:py-4 animate-fade-in-fast">
                <div className="mt-0.5 flex-shrink-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-transparent sm:h-8 sm:w-8 sm:rounded-xl">
                    <Image
                      src={theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png'}
                      width={28}
                      height={28}
                      alt="Bot"
                      className="h-6 w-6 animate-pulse object-contain sm:h-7 sm:w-7"
                    />
                  </div>
                </div>
                <div className="w-full min-w-0 max-w-[calc(100%-2rem)] overflow-x-hidden sm:max-w-[85%]">
                  <div className="overflow-hidden rounded-[24px] border border-black/[0.06] bg-white/82 shadow-sm backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#0c1220]/82">
                    <div className="border-b border-black/[0.05] dark:border-white/[0.05]">
                      <ReasoningDisclosure
                        runId={activeRunId}
                        events={events}
                        activeState={activeState}
                        isRunning
                        onLoadEvents={loadEventsForRun}
                      />
                    </div>
                    <div className="p-4">
                      <ThinkingBody activeState={activeState} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        )}

        <div
          className={clsx(
            'w-full self-center transition-all duration-200',
            inChatMode ? 'max-w-4xl pt-2' : 'mt-6 max-w-3xl sm:mt-8',
          )}
        >
          <ResearchInput onSubmit={handleSubmit} isLoading={isSubmitting} />
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 flex w-full max-w-4xl items-start gap-2.5 self-center rounded-2xl border border-red-500/20 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:bg-red-500/[0.08] dark:text-red-300 sm:mt-4 sm:gap-3 sm:px-4 sm:py-3 sm:text-sm"
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
