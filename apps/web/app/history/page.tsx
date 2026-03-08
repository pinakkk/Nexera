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
  CheckCircle2,
  XCircle,
  Timer,
} from 'lucide-react';
import clsx from 'clsx';
import { listRuns, deleteRun } from '@/lib/api';
import { RunStatus } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Date grouping helpers                                              */
/* ------------------------------------------------------------------ */

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const todayStart = startOfDay(now);
  const itemStart = startOfDay(d);
  const diff = todayStart - itemStart;

  if (diff === 0) return 'Today';
  if (diff <= 86400000) return 'Yesterday';
  if (diff <= 86400000 * 7) return 'This Week';
  return 'Older';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    completed: {
      icon: <CheckCircle2 size={12} />,
      cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      label: 'Completed',
    },
    failed: {
      icon: <XCircle size={12} />,
      cls: 'bg-red-500/10 text-red-400 border-red-500/20',
      label: 'Failed',
    },
    running: {
      icon: <Timer size={12} className="animate-spin" />,
      cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      label: 'Running',
    },
    pending: {
      icon: <Clock size={12} />,
      cls: 'bg-zinc-500/10 text-neutral-500 dark:text-zinc-400 border-zinc-500/20',
      label: 'Pending',
    },
  };
  const c = config[status] ?? config.pending;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        c.cls,
      )}
    >
      {c.icon}
      {c.label}
    </span>
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRuns(100, 0);
      setRuns(data);
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

  const filtered = useMemo(() => {
    if (!search.trim()) return runs;
    const q = search.toLowerCase();
    return runs.filter(
      (r) =>
        r.query.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        (r.model_name && r.model_name.toLowerCase().includes(q)),
    );
  }, [runs, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, RunStatus[]> = {};
    for (const run of filtered) {
      const label = groupLabel(run.created_at);
      (groups[label] ??= []).push(run);
    }
    return GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({
      label: g,
      runs: groups[g],
    }));
  }, [filtered]);

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-white dark:bg-[#0a0a0a]">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-zinc-100 sm:text-3xl">Research History</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-zinc-400">Browse and manage your past research runs.</p>
        </div>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by query, status, or model..."
            className="w-full rounded-xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 py-2.5 pl-10 pr-4 text-sm text-neutral-900 dark:text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20"
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-orange-500" />
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300"
            >
              <AlertCircle size={16} className="shrink-0 text-red-500" />
              <span className="flex-1">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Clock size={40} className="mb-4 text-neutral-600 dark:text-zinc-700" />
            <p className="text-neutral-500 dark:text-zinc-400">
              {search.trim() ? 'No runs match your search.' : 'No research runs yet.'}
            </p>
          </div>
        )}

        {/* Grouped runs */}
        {!loading && grouped.map((group) => (
          <div key={group.label} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-zinc-500">
              {group.label}
            </h2>
            <div className="space-y-2">
              {group.runs.map((run) => (
                <motion.button
                  key={run.run_id}
                  type="button"
                  onClick={() => router.push(`/?continue=${run.run_id}`)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group flex w-full items-start gap-3 rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-zinc-100 group-hover:text-orange-400 transition-colors">
                      {run.query || 'Untitled run'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={run.status} />
                      {run.model_name && (
                        <span className="text-[10px] text-neutral-400 dark:text-zinc-500">{run.model_name}</span>
                      )}
                      <span className="text-[10px] text-neutral-500 dark:text-zinc-600">
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, run.run_id)}
                    disabled={deletingId === run.run_id}
                    className="shrink-0 rounded-lg p-2 text-neutral-500 dark:text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                    title="Delete run"
                  >
                    {deletingId === run.run_id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
