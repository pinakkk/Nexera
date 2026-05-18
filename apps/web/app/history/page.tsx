'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Trash2,
  Loader2,
  AlertCircle,
  Clock,
  FileText,
  ChevronRight,
  Plus,
} from 'lucide-react';
import clsx from 'clsx';
import { listRuns, deleteRun } from '@/lib/api';
import { RunStatus } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diff = startOfDay(now) - startOfDay(d);
  if (diff === 0) return 'Today';
  if (diff <= 86400000) return 'Yesterday';
  if (diff <= 86400000 * 7) return 'This Week';
  return 'Older';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];

function runtimeOf(run: RunStatus): string | null {
  if (!run.completed_at) return null;
  const ms = new Date(run.completed_at).getTime() - new Date(run.created_at).getTime();
  if (ms <= 0 || Number.isNaN(ms)) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function timeLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

type FilterTab = 'all' | 'completed' | 'failed';

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex-1 px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
        {label}
      </p>
      <p className="h-display mt-2 text-2xl font-bold text-[rgb(var(--fg))]">
        {value}
      </p>
      <p className="mt-1 text-xs text-[rgb(var(--fg-subtle))]">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function HistoryPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await listRuns(100, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleDelete = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(runId);
    try {
      await deleteRun(runId);
      setRuns((prev) => prev.filter((r) => r.run_id !== runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete run');
    } finally {
      setDeletingId(null);
    }
  };

  const stats = useMemo(() => {
    const total = runs.length;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const now = new Date();
    const thisMonth = runs.filter((r) => {
      const d = new Date(r.created_at);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    }).length;
    const durations = runs
      .map((r) => {
        if (!r.completed_at) return null;
        const ms =
          new Date(r.completed_at).getTime() - new Date(r.created_at).getTime();
        return ms > 0 ? ms : null;
      })
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    const median = durations.length
      ? durations[Math.floor(durations.length / 2)]
      : 0;
    const fmt = (ms: number) => {
      const s = Math.round(ms / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    };
    const successRate = total ? ((completed / total) * 100).toFixed(1) : '—';
    return {
      total,
      thisMonth,
      median: median ? fmt(median) : '—',
      fastest: durations.length ? fmt(durations[0]) : '—',
      successRate,
      failed,
    };
  }, [runs]);

  const filtered = useMemo(() => {
    let list = runs;
    if (tab === 'completed') list = list.filter((r) => r.status === 'completed');
    if (tab === 'failed') list = list.filter((r) => r.status === 'failed');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.query.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          (r.model_name && r.model_name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [runs, search, tab]);

  const grouped = useMemo(() => {
    const groups: Record<string, RunStatus[]> = {};
    for (const run of filtered) {
      (groups[groupLabel(run.created_at)] ??= []).push(run);
    }
    return GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({
      label: g,
      runs: groups[g],
    }));
  }, [filtered]);

  return (
    <div className="relative min-h-[100dvh]">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-subtle))]">
              Workspace
            </p>
            <h1 className="h-display mt-2 text-3xl font-bold text-[rgb(var(--fg))] sm:text-4xl">
              History
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-muted))]">
              Every research run you&apos;ve ever started. Open one to read the
              full report, reasoning trace, and sources.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="btn-primary shrink-0"
          >
            <Plus size={16} />
            New research
          </button>
        </div>

        {/* Stats strip */}
        <div className="glass-panel-solid mb-6 flex flex-col divide-y divide-black/[0.06] rounded-2xl dark:divide-white/[0.06] sm:flex-row sm:divide-x sm:divide-y-0">
          <Stat
            label="Total runs"
            value={String(stats.total)}
            sub={`this month: ${stats.thisMonth}`}
          />
          <Stat
            label="Completed"
            value={String(stats.total - stats.failed)}
            sub={`${stats.failed} failed`}
          />
          <Stat
            label="Median runtime"
            value={stats.median}
            sub={`fastest ${stats.fastest}`}
          />
          <Stat
            label="Success rate"
            value={stats.successRate === '—' ? '—' : `${stats.successRate}%`}
            sub={`${stats.failed} failed`}
          />
        </div>

        {/* Controls */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-full border border-black/[0.08] bg-white/60 p-1 dark:border-white/[0.08] dark:bg-white/[0.03]">
            {(['all', 'completed', 'failed'] as FilterTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={clsx(
                  'rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-all',
                  tab === t
                    ? 'bg-[rgb(var(--fg))] text-[rgb(var(--bg-elevated))]'
                    : 'text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg))]',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--fg-subtle))]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, status, or model…"
              className="glass-input pl-10"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={26} className="animate-spin text-orange-500" />
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-500 dark:text-red-300"
            >
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Clock size={36} className="mb-4 text-[rgb(var(--fg-subtle))]" />
            <p className="text-sm text-[rgb(var(--fg-muted))]">
              {search.trim() || tab !== 'all'
                ? 'No runs match your filters.'
                : 'No research runs yet.'}
            </p>
          </div>
        )}

        {/* Grouped list */}
        {!loading &&
          grouped.map((group) => (
            <div key={group.label} className="mb-9">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(var(--fg-subtle))]">
                  {group.label}
                </h2>
                <span className="text-[11px] text-[rgb(var(--fg-subtle))]">
                  · {group.runs.length}
                </span>
                <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/[0.06]" />
              </div>
              <div className="glass-panel-solid divide-y divide-black/[0.05] overflow-hidden rounded-2xl dark:divide-white/[0.05]">
                {group.runs.map((run) => {
                  const rt = runtimeOf(run);
                  return (
                    <motion.button
                      key={run.run_id}
                      type="button"
                      onClick={() => router.push(`/?continue=${run.run_id}`)}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                    >
                      <FileText
                        size={17}
                        className="mt-0.5 shrink-0 self-start text-[rgb(var(--fg-subtle))]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-[rgb(var(--fg))] transition-colors group-hover:text-orange-600 dark:group-hover:text-orange-400">
                          {run.query || 'Untitled run'}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {run.status !== 'completed' && (
                            <span
                              className={clsx(
                                run.status === 'failed'
                                  ? 'chip-error'
                                  : run.status === 'running'
                                    ? 'chip-accent'
                                    : 'chip-neutral',
                              )}
                            >
                              {run.status}
                            </span>
                          )}
                          {run.model_name && (
                            <span className="font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
                              {run.model_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                        <span className="text-xs text-[rgb(var(--fg-muted))]">
                          {timeLabel(run.created_at)}
                        </span>
                        {rt && (
                          <span className="font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
                            {rt}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleDelete(e, run.run_id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleDelete(
                                e as unknown as React.MouseEvent,
                                run.run_id,
                              );
                          }}
                          className="rounded-lg p-2 text-[rgb(var(--fg-subtle))] opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                          title="Delete run"
                        >
                          {deletingId === run.run_id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </span>
                        <ChevronRight
                          size={16}
                          className="text-[rgb(var(--fg-subtle))] transition-transform group-hover:translate-x-0.5"
                        />
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
