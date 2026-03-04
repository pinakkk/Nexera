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

  // Always hide internal states
  if (HIDDEN_STATES.has(state)) return false;

  // Hide events that are purely internal scoring
  if (state.includes('guard') && !state.includes('block')) return false;
  if (state === 'complexity_scored') return false;

  return true;
}

/* ── User-friendly message rewriting ───────────────────────────────── */

function friendlyMessage(event: RunEvent): string {
  const state = event.state.toLowerCase();
  const payload = event.payload;

  // Research gate — show the route decision
  if (state === 'research_gate') {
    const route = (payload as any)?.gate_result?.route;
    if (route === 'CHAT_ONLY') return TEXT_CONFIG.traceTimeline.routeQuickChat;
    if (route === 'DIRECT_ANSWER') return TEXT_CONFIG.traceTimeline.routeDirectAnswer;
    if (route === 'LIGHT_LOOKUP') return TEXT_CONFIG.traceTimeline.routeLightLookup;
    if (route === 'FULL_RESEARCH') return TEXT_CONFIG.traceTimeline.routeFullResearch;
    return event.message || TEXT_CONFIG.traceTimeline.routeClassifying;
  }

  // Plan
  if (state.includes('plan_complete') || state.includes('plan')) {
    const subQs = (payload as any)?.plan?.sub_questions;
    if (Array.isArray(subQs) && subQs.length > 0) {
      return `${TEXT_CONFIG.traceTimeline.planCreatedPrefix} ${subQs.length} ${TEXT_CONFIG.traceTimeline.planCreatedSuffix}`;
    }
  }

  // Search
  if (state.includes('search_complete')) {
    const count = (payload as any)?.result_count;
    if (typeof count === 'number') {
      return `${TEXT_CONFIG.traceTimeline.searchFoundPrefix} ${count} ${TEXT_CONFIG.traceTimeline.searchFoundSuffix}`;
    }
  }

  // Fetch
  if (state.includes('fetch_complete')) {
    const fetched = (payload as any)?.fetched_count;
    const total = (payload as any)?.total_urls;
    if (typeof fetched === 'number') {
      return `${TEXT_CONFIG.traceTimeline.fetchedPrefix} ${fetched}/${total || '?'} ${TEXT_CONFIG.traceTimeline.fetchedSuffix}`;
    }
  }

  // Index
  if (state.includes('index_complete')) {
    const chunks = (payload as any)?.total_chunks;
    if (typeof chunks === 'number') {
      return `${TEXT_CONFIG.traceTimeline.indexedPrefix} ${chunks} ${TEXT_CONFIG.traceTimeline.indexedSuffix}`;
    }
  }

  // Retrieve
  if (state.includes('retrieve_complete')) {
    const count = (payload as any)?.evidence_count;
    if (typeof count === 'number') {
      return `${TEXT_CONFIG.traceTimeline.retrievedPrefix} ${count} ${TEXT_CONFIG.traceTimeline.retrievedSuffix}`;
    }
  }

  // Synthesize
  if (state.includes('synth')) {
    const len = (payload as any)?.report_length;
    if (typeof len === 'number') {
      return `${TEXT_CONFIG.traceTimeline.reportWrittenPrefix} (${Math.round(len / 1000)}k chars)`;
    }
    return TEXT_CONFIG.traceTimeline.reportWriting;
  }

  // Verification
  if (state.includes('verification_complete')) {
    const passed = (payload as any)?.overall_passed;
    return passed
      ? TEXT_CONFIG.traceTimeline.reportPassed
      : TEXT_CONFIG.traceTimeline.reportNeedsRefine;
  }

  // Refine
  if (state.includes('refine')) {
    return TEXT_CONFIG.traceTimeline.refiningReport;
  }

  // Finalize
  if (state.includes('final')) {
    return TEXT_CONFIG.traceTimeline.researchComplete;
  }

  // PDF
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

  // Failed
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
  if (isActive) return 'bg-blue-500/12 text-blue-500 dark:text-blue-300';
  if (state.includes('fail') || state.includes('error'))
    return 'bg-red-500/12 text-red-500 dark:text-red-300';
  if (state.includes('final') || state.includes('pdf'))
    return 'bg-emerald-500/12 text-emerald-500 dark:text-emerald-300';
  if (state.includes('gate'))
    return 'bg-purple-500/12 text-purple-500 dark:text-purple-300';
  return 'bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300';
}

/* ── Component ─────────────────────────────────────────────────────── */

export function TraceTimeline({ events, activeState }: TraceTimelineProps) {
  // Filter to interactive events only
  const visibleEvents = events.filter(isInteractiveEvent);

  if (visibleEvents.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        {TEXT_CONFIG.traceTimeline.waitingForEvents}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {visibleEvents.map((event, index) => {
        const Icon = stateIcon(event.state);
        const isActive = event.state === activeState;
        const isLast = index === visibleEvents.length - 1;
        const message = friendlyMessage(event);

        return (
          <div key={event.id} className="trace-item flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${stateColor(event.state, isActive)}`}
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
                  <span className="text-[10px] rounded-full bg-orange-500/10 text-orange-500 px-1.5 py-0.5 font-medium">
                    iter {event.iteration}
                  </span>
                )}
              </div>
              {message && (
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {message}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
