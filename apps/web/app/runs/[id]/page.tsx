'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, X } from 'lucide-react';
import clsx from 'clsx';
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
          This detail view keeps the answer and reasoning together in one stream.
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

export default function RunPage() {
  const params = useParams();
  const initialRunId = params.id as string;
  const { theme } = useTheme();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusValue>('pending');
  const [activeState, setActiveState] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runResultsMap, setRunResultsMap] = useState<Record<string, RunResult>>({});
  const [runEventsMap, setRunEventsMap] = useState<Record<string, RunEvent[]>>({});

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const hasActiveRun = Boolean(activeRunId);
  const isRunRunning = runStatus === 'pending' || runStatus === 'running';
  const lastThreadRunId =
    [...messages].reverse().find((message) => message.runId)?.runId ?? initialRunId;

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

  const loadThread = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const initialRun = await getRun(initialRunId);
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
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : TEXT_CONFIG.runPage.loadFailed,
      );
    } finally {
      setIsLoading(false);
    }
  }, [initialRunId, startStreaming]);

  useEffect(() => {
    void loadThread();
    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
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
        setError('Please configure your Groq API Key in Settings before continuing.');
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
        window.history.replaceState({}, '', `/runs/${run_id}`);
        startStreaming(run_id);
      } catch (submitError) {
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

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.05] bg-white/70 px-8 py-7 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#11141b]/70">
          <Loader2 size={28} className="animate-spin text-orange-500" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {TEXT_CONFIG.runPage.loadingResearch}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col px-3 pb-4 pt-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/?continue=${activeRunId ?? lastThreadRunId}`}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/70 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-300 dark:hover:text-white"
          >
            <ArrowLeft size={13} />
            Back to chat
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-500">
              Research details
            </p>
            <h1 className="max-w-3xl text-base font-semibold text-neutral-900 dark:text-white sm:text-lg">
              {messages[0]?.content || TEXT_CONFIG.runPage.noQueryFallback}
            </h1>
          </div>
        </header>

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
                              href={`/?continue=${message.runId}`}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:text-orange-600 dark:hover:text-orange-400"
                            >
                              Continue in chat
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

        <div className="w-full self-center max-w-4xl pt-2">
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
      </div>
    </div>
  );
}
