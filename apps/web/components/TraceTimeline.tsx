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
    if (route === 'CHAT_ONLY') return 'Quick chat response — no research needed';
    if (route === 'DIRECT_ANSWER') return 'Direct answer — no deep research needed';
    if (route === 'LIGHT_LOOKUP') return 'Light lookup mode';
    if (route === 'FULL_RESEARCH') return 'Starting full research pipeline';
    return event.message || 'Classifying query...';
  }

  // Plan
  if (state.includes('plan_complete') || state.includes('plan')) {
    const subQs = (payload as any)?.plan?.sub_questions;
    if (Array.isArray(subQs) && subQs.length > 0) {
      return `Created ${subQs.length} research sub-questions`;
    }
  }

  // Search
  if (state.includes('search_complete')) {
    const count = (payload as any)?.result_count;
    if (typeof count === 'number') return `Found ${count} search results`;
  }

  // Fetch
  if (state.includes('fetch_complete')) {
    const fetched = (payload as any)?.fetched_count;
    const total = (payload as any)?.total_urls;
    if (typeof fetched === 'number') return `Fetched ${fetched}/${total || '?'} pages`;
  }

  // Index
  if (state.includes('index_complete')) {
    const chunks = (payload as any)?.total_chunks;
    if (typeof chunks === 'number') return `Indexed ${chunks} content chunks`;
  }

  // Retrieve
  if (state.includes('retrieve_complete')) {
    const count = (payload as any)?.evidence_count;
    if (typeof count === 'number') return `Retrieved ${count} evidence pieces`;
  }

  // Synthesize
  if (state.includes('synth')) {
    const len = (payload as any)?.report_length;
    if (typeof len === 'number') return `Report written (${Math.round(len / 1000)}k chars)`;
    return 'Writing research report...';
  }

  // Verification
  if (state.includes('verification_complete')) {
    const passed = (payload as any)?.overall_passed;
    return passed ? '✅ Report passed quality checks' : '⚠️ Report needs refinement';
  }

  // Refine
  if (state.includes('refine')) {
    return 'Refining report based on evaluation feedback';
  }

  // Finalize
  if (state.includes('final')) {
    return '🎉 Research complete!';
  }

  // PDF
  if (state === 'pdf_generated') {
    return '📄 PDF report generated';
  }

  // Failed
  if (state.includes('fail') || state.includes('error')) {
    const err = (payload as any)?.error;
    if (typeof err === 'string') return err.slice(0, 120);
    return event.message || 'An error occurred';
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
  if (state.includes('transcri')) return Mic;
  if (state.includes('fail') || state.includes('error')) return AlertCircle;
  return Zap;
}

function stateColor(state: string, isActive: boolean): string {
  if (isActive) return 'border-blue-400/40 bg-blue-500/10 text-blue-500 dark:text-blue-300';
  if (state.includes('fail') || state.includes('error'))
    return 'border-red-400/40 bg-red-500/10 text-red-500 dark:text-red-300';
  if (state.includes('final') || state.includes('pdf'))
    return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-300';
  if (state.includes('gate'))
    return 'border-purple-400/40 bg-purple-500/10 text-purple-500 dark:text-purple-300';
  return 'border-black/10 bg-white text-neutral-600 dark:border-white/10 dark:bg-[#141414] dark:text-neutral-300';
}

/* ── Component ─────────────────────────────────────────────────────── */

export function TraceTimeline({ events, activeState }: TraceTimelineProps) {
  // Filter to interactive events only
  const visibleEvents = events.filter(isInteractiveEvent);

  if (visibleEvents.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        Waiting for live events...
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
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${stateColor(event.state, isActive)}`}
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
