'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listRuns } from '@/lib/api';
import { RunStatus, RunStatusValue } from '@/lib/types';
import {
  Clock,
  Search,
  AlertCircle,
  Inbox,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Status badge configuration                                         */
/* ------------------------------------------------------------------ */

const statusConfig: Record<
  RunStatusValue,
  { label: string; dotClass: string; badgeClass: string }
> = {
  pending: {
    label: 'Pending',
    dotClass: 'bg-neutral-400',
    badgeClass: 'bg-neutral-500/10 text-neutral-700 dark:text-neutral-400 border border-neutral-500/20',
  },
  running: {
    label: 'Running',
    dotClass: 'bg-blue-400 animate-pulse',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-emerald-400',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-400',
    badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-black/10 dark:border-white/[0.06]">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-3/4 bg-black/[0.06] dark:bg-white/[0.06] rounded animate-pulse" />
        <div className="h-3 w-1/3 bg-black/[0.04] dark:bg-white/[0.04] rounded animate-pulse" />
      </div>
      <div className="h-6 w-20 bg-black/[0.06] dark:bg-white/[0.06] rounded-full animate-pulse" />
      <div className="h-4 w-16 bg-black/[0.04] dark:bg-white/[0.04] rounded animate-pulse" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.06] mb-6">
        <Inbox size={28} strokeWidth={1.5} className="text-neutral-500" />
      </div>
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">
        No research runs yet
      </h3>
      <p className="text-sm text-neutral-400 text-center max-w-sm mb-6">
        Start a new research query to see your runs appear here. Each run will
        be tracked with its status, iterations, and results.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 hover:bg-orange-500 rounded-xl transition-colors"
      >
        Start Research
        <ArrowRight size={16} strokeWidth={2} />
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  async function fetchRuns() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRuns(50, 0);
      setRuns(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load research history.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchRuns();
  }, []);

  const filteredRuns = searchFilter
    ? runs.filter((r) =>
        r.query.toLowerCase().includes(searchFilter.toLowerCase()),
      )
    : runs;

  return (
    <div className="flex min-h-screen flex-col px-3 pb-6 pt-14 sm:px-8 sm:pt-8">
      {/* Header */}
      <div className="shrink-0 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <Clock size={20} strokeWidth={1.75} className="text-neutral-500 dark:text-neutral-400" />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Research History</h1>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-500 ml-8">
          Browse and revisit past research runs.
        </p>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            strokeWidth={2}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            type="text"
            placeholder="Filter by query..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-500 bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-xl focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-colors"
          />
        </div>
        <button
          onClick={fetchRuns}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-xl hover:border-black/20 dark:hover:border-white/[0.1] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            className={isLoading ? 'animate-spin' : ''}
          />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} strokeWidth={2} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Runs list */}
      <div className="flex-1">
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/[0.06] dark:bg-[#111]">
          {/* Table header - hidden on mobile */}
          <div className="hidden items-center gap-4 px-5 py-3 border-b border-black/10 dark:border-white/[0.06] text-[11px] font-medium text-neutral-500 uppercase tracking-wider sm:flex">
            <div className="flex-1 min-w-0">Query</div>
            <div className="w-24 text-center">Status</div>
            <div className="w-20 text-center">Iterations</div>
            <div className="w-24 text-right">Created</div>
            <div className="w-8" />
          </div>

          {/* Content */}
          {isLoading ? (
            <LoadingSkeleton />
          ) : filteredRuns.length === 0 && runs.length === 0 ? (
            <EmptyState />
          ) : filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <Search
                size={24}
                strokeWidth={1.5}
                className="text-neutral-400 dark:text-neutral-600 mb-3"
              />
              <p className="text-sm text-neutral-500">
                No runs match &ldquo;{searchFilter}&rdquo;
              </p>
            </div>
          ) : (
            filteredRuns.map((run) => {
              const config = statusConfig[run.status];
              return (
                <Link
                  key={run.run_id}
                  href={`/runs/${run.run_id}`}
                  className="group flex flex-col gap-2 px-4 py-4 border-b border-black/10 dark:border-white/[0.06] last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  {/* Query */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white truncate group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors">
                      {truncate(run.query, 80)}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 font-mono">
                      {run.run_id.slice(0, 8)}
                    </p>
                  </div>

                  {/* Mobile meta row */}
                  <div className="flex items-center gap-3 sm:contents">
                    {/* Status badge */}
                    <div className="sm:w-24 sm:flex sm:justify-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full ${config.badgeClass}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`}
                        />
                        {config.label}
                      </span>
                    </div>

                    {/* Iterations */}
                    <div className="sm:w-20 sm:text-center">
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">
                        {run.iteration}
                        {run.max_iterations > 0 && (
                          <span className="text-neutral-400 dark:text-neutral-600">
                            /{run.max_iterations}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Date */}
                    <div className="ml-auto sm:w-24 sm:text-right sm:ml-0">
                      <span className="text-xs text-neutral-500">
                        {formatDate(run.created_at)}
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="hidden sm:flex w-8 justify-center">
                      <ArrowRight
                        size={14}
                        strokeWidth={2}
                        className="text-neutral-400 dark:text-neutral-700 group-hover:text-neutral-600 dark:group-hover:text-neutral-400 transition-colors"
                      />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
