'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Trash2,
  Loader2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import clsx from 'clsx';
import { listMemories, deleteMemory, getMemoryStats } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  confidence: number;
  created_at: string;
}

interface MemoryStats {
  total: number;
  by_category: Record<string, number>;
}

const CATEGORIES = ['fact', 'source_pref', 'reasoning_trace', 'run_summary'] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function categoryBadge(category: string) {
  const styles: Record<string, string> = {
    fact: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    source_pref: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    reasoning_trace: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    run_summary: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  };
  const labels: Record<string, string> = {
    fact: 'Fact',
    source_pref: 'Source Pref',
    reasoning_trace: 'Reasoning',
    run_summary: 'Summary',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        styles[category] ?? 'bg-zinc-500/10 text-neutral-500 dark:text-zinc-400 border-zinc-500/20',
      )}
    >
      {labels[category] ?? category}
    </span>
  );
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 rounded-full bg-neutral-200 dark:bg-zinc-800">
        <div
          className={clsx(
            'h-1 rounded-full transition-all',
            pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-neutral-400 dark:text-zinc-500">{pct}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function MemoryPage() {
  const { user } = useAuth();
  const isSignedIn = !!user;
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memData, statsData] = await Promise.all([
        listMemories(filter ?? undefined, 100),
        getMemoryStats(),
      ]);
      setMemories(memData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (memoryId: string) => {
    if (deletingId) return;
    setDeletingId(memoryId);
    try {
      await deleteMemory(memoryId);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      if (stats) {
        setStats({ ...stats, total: stats.total - 1 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-white dark:bg-[#0a0a0a]">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Brain size={28} className="text-orange-500" />
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-zinc-100 sm:text-3xl">Agent Remembers</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-zinc-400">
            Persistent memory entries the agent uses to improve future research.
          </p>
          {!isSignedIn && (
            <p className="mt-2 text-xs text-neutral-500 dark:text-zinc-500">
              Durable long-term memory is available after sign-in. Anonymous sessions keep
              thread context and history only in this browser.
            </p>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-4">
              <p className="text-xs text-neutral-400 dark:text-zinc-500">Total</p>
              <p className="mt-1 text-2xl font-bold text-neutral-900 dark:text-zinc-100">{stats.total}</p>
            </div>
            {CATEGORIES.map((cat) => (
              <div key={cat} className="rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-4">
                <p className="text-xs text-neutral-400 dark:text-zinc-500 capitalize">
                  {cat.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 text-2xl font-bold text-neutral-900 dark:text-zinc-100">
                  {stats.by_category[cat] ?? 0}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-6 flex items-center gap-2 overflow-x-auto">
          <Filter size={14} className="shrink-0 text-neutral-400 dark:text-zinc-500" />
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={clsx(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === null
                ? 'border-orange-500/30 bg-orange-500/10 text-orange-400'
                : 'border-neutral-200 dark:border-zinc-800 text-neutral-400 dark:text-zinc-500 hover:text-zinc-300',
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={clsx(
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === cat
                  ? 'border-orange-500/30 bg-orange-500/10 text-orange-400'
                  : 'border-neutral-200 dark:border-zinc-800 text-neutral-400 dark:text-zinc-500 hover:text-zinc-300',
              )}
            >
              {cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

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

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-orange-500" />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && memories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Brain size={40} className="mb-4 text-zinc-700" />
            <p className="text-neutral-500 dark:text-zinc-400">
              {filter ? 'No memories in this category.' : 'No memories stored yet.'}
            </p>
          </div>
        )}

        {/* Memory list */}
        {!loading && memories.length > 0 && (
          <div className="space-y-2">
            {memories.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="group rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-4 transition-colors hover:border-neutral-300 dark:hover:border-zinc-700"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-800 dark:text-zinc-200 leading-relaxed line-clamp-3">
                      {entry.content}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {categoryBadge(entry.category)}
                      {confidenceBar(entry.confidence)}
                      <span className="text-[10px] text-neutral-500 dark:text-zinc-600">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={deletingId === entry.id}
                    className="shrink-0 rounded-lg p-2 text-neutral-500 dark:text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                    title="Delete memory"
                  >
                    {deletingId === entry.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
