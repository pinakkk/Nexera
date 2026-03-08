'use client';

import { RunEvent, formatAgentStateLabel } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
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
  Shield,
  Mic,
  Filter,
  FileText,
  Zap,
} from 'lucide-react';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ── States to HIDE from the trace (internal/non-interactive) ──────── */

const HIDDEN_STATES = new Set([
  'prompt_guard',
  'evaluation_complete',
  'evidence_packed',
  'complexity_scored',
  'kg_extraction_skipped',
  'kg_extract',
  'kg_extract_complete',
  'academic_search',
  'academic_search_complete',
  'verification_started',
]);

/** Returns true if an event should be shown to the user */
function isInteractiveEvent(event: RunEvent): boolean {
  const state = event.state.toLowerCase();
  if (HIDDEN_STATES.has(state)) return false;
  if (state.includes('guard') && !state.includes('block')) return false;
  if (state === 'complexity_scored') return false;
  return true;
}

/* ── User-friendly message rewriting ───────────────────────────────── */

function friendlyMessage(event: RunEvent): string {
  const state = event.state.toLowerCase();
  const payload = event.payload;

  if (state === 'research_gate') {
    const route = (payload as any)?.gate_result?.route;
    if (route === 'CHAT_ONLY') return TEXT_CONFIG.traceTimeline.routeQuickChat;
    if (route === 'DIRECT_ANSWER') return TEXT_CONFIG.traceTimeline.routeDirectAnswer;
    if (route === 'LIGHT_LOOKUP') return TEXT_CONFIG.traceTimeline.routeLightLookup;
    if (route === 'FULL_RESEARCH') return TEXT_CONFIG.traceTimeline.routeFullResearch;
    return event.message || TEXT_CONFIG.traceTimeline.routeClassifying;
  }

  if (state.includes('plan_complete') || state.includes('plan')) {
    const subQs = (payload as any)?.plan?.sub_questions;
    if (Array.isArray(subQs) && subQs.length > 0) {
      return `${TEXT_CONFIG.traceTimeline.planCreatedPrefix} ${subQs.length} ${TEXT_CONFIG.traceTimeline.planCreatedSuffix}`;
    }
  }

  if (state.includes('search_complete')) {
    const count = (payload as any)?.result_count;
    if (typeof count === 'number') {
      return `${TEXT_CONFIG.traceTimeline.searchFoundPrefix} ${count} ${TEXT_CONFIG.traceTimeline.searchFoundSuffix}`;
    }
  }

  if (state.includes('fetch_complete')) {
    const fetched = (payload as any)?.fetched_count;
    const total = (payload as any)?.total_urls;
    if (typeof fetched === 'number') {
      return `${TEXT_CONFIG.traceTimeline.fetchedPrefix} ${fetched}/${total || '?'} ${TEXT_CONFIG.traceTimeline.fetchedSuffix}`;
    }
  }

  if (state.includes('index_complete')) {
    const chunks = (payload as any)?.total_chunks;
    if (typeof chunks === 'number') {
      return `${TEXT_CONFIG.traceTimeline.indexedPrefix} ${chunks} ${TEXT_CONFIG.traceTimeline.indexedSuffix}`;
    }
  }

  if (state.includes('retrieve_complete')) {
    const count = (payload as any)?.evidence_count;
    if (typeof count === 'number') {
      return `${TEXT_CONFIG.traceTimeline.retrievedPrefix} ${count} ${TEXT_CONFIG.traceTimeline.retrievedSuffix}`;
    }
  }

  if (state.includes('synth')) {
    const len = (payload as any)?.report_length;
    if (typeof len === 'number') {
      return `${TEXT_CONFIG.traceTimeline.reportWrittenPrefix} (${Math.round(len / 1000)}k chars)`;
    }
    return TEXT_CONFIG.traceTimeline.reportWriting;
  }

  if (state.includes('verification_complete')) {
    const passed = (payload as any)?.overall_passed;
    return passed
      ? TEXT_CONFIG.traceTimeline.reportPassed
      : TEXT_CONFIG.traceTimeline.reportNeedsRefine;
  }

  if (state.includes('refine')) {
    return TEXT_CONFIG.traceTimeline.refiningReport;
  }

  if (state.includes('final')) {
    return TEXT_CONFIG.traceTimeline.researchComplete;
  }

  if (state === 'pdf_generated') {
    return TEXT_CONFIG.traceTimeline.pdfGenerated;
  }

  if (state === 'steering_queued') {
    return TEXT_CONFIG.traceTimeline.steeringQueued;
  }

  if (state === 'steering_applied') {
    const count = (payload as any)?.notes_count;
    if (typeof count === 'number') {
      return `${TEXT_CONFIG.traceTimeline.steeringAppliedPrefix} ${count} ${TEXT_CONFIG.traceTimeline.steeringAppliedSuffix}`;
    }
    return TEXT_CONFIG.traceTimeline.steeringAppliedGeneric;
  }

  if (state.includes('fail') || state.includes('error')) {
    const err = (payload as any)?.error;
    if (typeof err === 'string') return err.slice(0, 120);
    return event.message || TEXT_CONFIG.traceTimeline.defaultError;
  }

  return event.message || '';
}

/* ── Icons ─────────────────────────────────────────────────────────── */

interface TraceTimelineProps {
  events: RunEvent[];
  activeState: string | null;
}

function stateIcon(state: string): React.ElementType {
  if (state.includes('research_gate') || state.includes('gate')) return Filter;
  if (state.includes('plan')) return Compass;
  if (state.includes('query')) return Search;
  if (state.includes('search')) return FileSearch;
  if (state.includes('fetch')) return Globe;
  if (state.includes('index')) return Database;
  if (state.includes('retrieve')) return BookOpen;
  if (state.includes('synth')) return PenTool;
  if (state.includes('verif')) return Shield;
  if (state.includes('evaluat')) return BarChart3;
  if (state.includes('refine')) return RefreshCw;
  if (state.includes('final')) return CheckCircle2;
  if (state.includes('pdf')) return FileText;
  if (state.includes('steer')) return Compass;
  if (state.includes('transcri')) return Mic;
  if (state.includes('fail') || state.includes('error')) return AlertCircle;
  return Zap;
}

function stateColor(state: string, isActive: boolean): string {
  if (isActive)
    return 'bg-orange-500/12 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20';
  if (state.includes('fail') || state.includes('error'))
    return 'bg-red-500/10 text-red-500 dark:text-red-400';
  if (state.includes('final') || state.includes('pdf'))
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (state.includes('gate'))
    return 'bg-violet-500/10 text-violet-500 dark:text-violet-400';
  if (state.includes('search') || state.includes('query'))
    return 'bg-blue-500/10 text-blue-500 dark:text-blue-400';
  if (state.includes('synth') || state.includes('refine'))
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'bg-black/[0.035] text-neutral-500 dark:bg-white/[0.055] dark:text-neutral-400';
}

function lineColor(state: string, isActive: boolean): string {
  if (isActive) return 'bg-orange-500/30';
  if (state.includes('final') || state.includes('pdf')) return 'bg-emerald-500/20';
  if (state.includes('fail') || state.includes('error')) return 'bg-red-500/20';
  return 'bg-black/[0.08] dark:bg-white/[0.08]';
}

/* ── Progress bar state mapping ────────────────────────────────────── */

const STATE_PROGRESS: Record<string, number> = {
  intake: 5,
  plan: 15,
  wait_for_user: 20,
  research_loop: 30,
  retrieve_evidence: 45,
  rerank: 55,
  kg_extract: 60,
  synthesize: 70,
  verify: 80,
  refine: 85,
  finalize: 100,
};

function getProgressPercent(activeState: string | null, events: RunEvent[]): number {
  if (!activeState && events.length === 0) return 0;
  // Check active state first
  if (activeState) {
    const lower = activeState.toLowerCase();
    for (const [key, pct] of Object.entries(STATE_PROGRESS)) {
      if (lower.includes(key)) return pct;
    }
  }
  // Fall back to the last event state
  for (let i = events.length - 1; i >= 0; i--) {
    const state = events[i].state.toLowerCase();
    for (const [key, pct] of Object.entries(STATE_PROGRESS)) {
      if (state.includes(key)) return pct;
    }
  }
  // If we have events but can't match, estimate from count
  return Math.min(events.length * 8, 95);
}

/* ── Component ─────────────────────────────────────────────────────── */

export function TraceTimeline({ events, activeState }: TraceTimelineProps) {
  const visibleEvents = events.filter(isInteractiveEvent);
  const progressPercent = getProgressPercent(activeState, events);

  if (visibleEvents.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={18} className="animate-spin text-orange-500/60" />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {TEXT_CONFIG.traceTimeline.waitingForEvents}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* Progress bar */}
      <div className="mb-2 w-full">
        <div className="h-1 w-full rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500 text-right tabular-nums">
          {progressPercent}% complete
        </p>
      </div>
      {visibleEvents.map((event, index) => {
        const Icon = stateIcon(event.state);
        const isActive = event.state === activeState;
        const isLast = index === visibleEvents.length - 1;
        const message = friendlyMessage(event);

        return (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
            className="trace-item flex gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-black/[0.015] dark:hover:bg-white/[0.02]"
          >
            {/* Icon column with connector line */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${stateColor(event.state, isActive)}`}
              >
                {isActive ? (
                  <Icon size={12} strokeWidth={2.25} className="animate-pulse" />
                ) : (
                  <Icon size={12} strokeWidth={2} />
                )}
              </div>
              {!isLast && (
                <div className={`h-full min-h-[10px] w-px transition-colors ${lineColor(event.state, isActive)}`} />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[12px] font-semibold leading-tight ${isActive ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-800 dark:text-neutral-200'}`}>
                  {formatAgentStateLabel(event.state)}
                </span>
                {event.iteration > 0 && (
                  <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-500">
                    iter {event.iteration}
                  </span>
                )}
                <span className="ml-auto text-[10px] tabular-nums text-neutral-400 dark:text-neutral-600">
                  {new Date(event.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              {message && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {message}
                </p>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
