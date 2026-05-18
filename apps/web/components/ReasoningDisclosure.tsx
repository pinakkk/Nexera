'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { TraceTimeline } from './TraceTimeline';
import type { RunEvent } from '@/lib/types';

interface ReasoningDisclosureProps {
  runId: string;
  events: RunEvent[];
  activeState: string | null;
  gateRoute?: string | null;
  sourcesCount?: number;
  isRunning?: boolean;
  onLoadEvents?: (runId: string) => Promise<void>;
  embedded?: boolean;
}

function formatDurationLabel(events: RunEvent[]): string | null {
  if (events.length < 2) return null;
  const start = new Date(events[0].timestamp).getTime();
  const end = new Date(events[events.length - 1].timestamp).getTime();
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function inferGateRoute(events: RunEvent[], gateRoute?: string | null): string | null {
  if (gateRoute) return gateRoute;
  const gateEvent = events.find((event) => event.state === 'research_gate');
  const payload = gateEvent?.payload as Record<string, unknown> | null | undefined;
  const result = payload?.gate_result as Record<string, unknown> | null | undefined;
  return typeof result?.route === 'string' ? result.route : null;
}

function buildSummaryLabel(
  events: RunEvent[],
  gateRoute: string | null,
  sourcesCount: number,
  isRunning: boolean,
): string {
  const duration = formatDurationLabel(events);
  const isQuick = gateRoute != null && gateRoute !== 'FULL_RESEARCH';

  if (isRunning && isQuick) return 'Thinking…';
  if (isRunning) return 'See thinking';

  if (isQuick) {
    return duration ? `Thought for ${duration}` : 'See thinking';
  }

  if (sourcesCount > 0 && duration) {
    return `Researched ${sourcesCount} source${sourcesCount === 1 ? '' : 's'} in ${duration}`;
  }
  if (sourcesCount > 0) {
    return `Researched ${sourcesCount} source${sourcesCount === 1 ? '' : 's'}`;
  }
  if (duration) {
    return `See thinking · ${duration}`;
  }
  return 'See thinking';
}

export function ReasoningDisclosure({
  runId,
  events,
  activeState,
  gateRoute,
  sourcesCount = 0,
  isRunning = false,
  onLoadEvents,
  embedded = true,
}: ReasoningDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const resolvedGateRoute = useMemo(
    () => inferGateRoute(events, gateRoute),
    [events, gateRoute],
  );
  const summaryLabel = useMemo(
    () => buildSummaryLabel(events, resolvedGateRoute, sourcesCount, isRunning),
    [events, resolvedGateRoute, sourcesCount, isRunning],
  );

  const handleToggle = async () => {
    const next = !open;
    setOpen(next);

    if (!next || events.length > 0 || !onLoadEvents) return;

    setLoading(true);
    try {
      await onLoadEvents(runId);
    } finally {
      setLoading(false);
    }
  };

  const shouldShowTimeline = loading || events.length > 0;

  return (
    <div
      className={clsx(
        'overflow-hidden',
        embedded
          ? ''
          : 'rounded-[18px] border border-black/[0.06] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]',
      )}
    >
      <button
        type="button"
        onClick={() => void handleToggle()}
        className={clsx(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
          embedded ? 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
        )}
      >
        <span
          className={clsx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isRunning ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500',
          )}
        />
        <span className="min-w-0 flex-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 sm:text-xs">
          {summaryLabel}
        </span>
        {loading ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-neutral-400" />
        ) : (
          <ChevronDown
            size={13}
            className={clsx(
              'shrink-0 text-neutral-400 transition-transform',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && shouldShowTimeline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-black/[0.05] dark:border-white/[0.05]"
          >
            <div className={clsx('max-h-[38vh] overflow-y-auto px-3 py-3 sm:max-h-[44vh]', embedded && 'bg-black/[0.02] dark:bg-white/[0.02]')}>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={18} className="animate-spin text-orange-500" />
                </div>
              ) : (
                <TraceTimeline events={events} activeState={activeState} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
