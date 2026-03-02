'use client';

import { RunEvent, formatAgentStateLabel } from '@/lib/types';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Compass,
  Database,
  FileSearch,
  Globe,
  Loader2,
  PenTool,
  RefreshCw,
  Search,
} from 'lucide-react';

interface TraceTimelineProps {
  events: RunEvent[];
  activeState: string | null;
}

function stateIcon(state: string): React.ElementType {
  if (state.includes('plan')) return Compass;
  if (state.includes('query')) return Search;
  if (state.includes('search')) return FileSearch;
  if (state.includes('fetch')) return Globe;
  if (state.includes('index')) return Database;
  if (state.includes('retrieve')) return BookOpen;
  if (state.includes('synth')) return PenTool;
  if (state.includes('evaluat')) return BarChart3;
  if (state.includes('refine')) return RefreshCw;
  if (state.includes('final')) return CheckCircle2;
  if (state.includes('fail') || state.includes('error')) return AlertCircle;
  return Loader2;
}

function summarizePayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;

  const countKeys = [
    ['result_count', 'Results'],
    ['fetched_count', 'Fetched'],
    ['total_chunks', 'Chunks'],
    ['evidence_count', 'Evidence'],
    ['report_length', 'Report chars'],
    ['citation_count', 'Citations'],
  ] as const;

  const chunks: string[] = [];
  for (const [key, label] of countKeys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      chunks.push(`${label}: ${value}`);
    }
  }

  if (chunks.length > 0) {
    return chunks.join(' • ');
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors.find((item) => typeof item === 'string');
    if (typeof first === 'string' && first.trim()) {
      return first;
    }
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (Array.isArray(payload.queries) && payload.queries.length > 0) {
    return `${payload.queries.length} query candidates generated`;
  }

  return null;
}

export function TraceTimeline({ events, activeState }: TraceTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        Waiting for live events...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {events.map((event, index) => {
        const Icon = stateIcon(event.state);
        const isActive = event.state === activeState;
        const isLast = index === events.length - 1;
        const detail = summarizePayload(event.payload);

        return (
          <div key={event.id} className="trace-item flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                  isActive
                    ? 'border-blue-400/40 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                    : event.state.includes('fail') || event.state.includes('error')
                      ? 'border-red-400/40 bg-red-500/10 text-red-500 dark:text-red-300'
                      : 'border-black/10 bg-white text-neutral-600 dark:border-white/10 dark:bg-[#141414] dark:text-neutral-300'
                }`}
              >
                <Icon
                  size={14}
                  strokeWidth={2}
                  className={isActive ? 'animate-pulse' : ''}
                />
              </div>
              {!isLast && (
                <div className="h-full min-h-[16px] w-px bg-black/10 dark:bg-white/10" />
              )}
            </div>

            <div className="min-w-0 flex-1 pb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {formatAgentStateLabel(event.state)}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-500">
                  {new Date(event.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                {event.iteration > 0 && (
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-500">
                    iter {event.iteration}
                  </span>
                )}
              </div>
              {event.message && (
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  {event.message}
                </p>
              )}
              {detail && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
                  {detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
