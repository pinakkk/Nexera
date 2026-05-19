'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2,
  Loader2,
  AlertCircle,
  FileText,
  Globe,
  GitCompare,
  BookMarked,
  Layers,
  Download,
  Plus,
} from 'lucide-react';
import clsx from 'clsx';
import { listMemories, deleteMemory, getMemoryStats } from '@/lib/api';

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

const CATEGORIES = [
  'fact',
  'source_pref',
  'reasoning_trace',
  'run_summary',
] as const;

const CAT_META: Record<
  string,
  { label: string; short: string; icon: typeof FileText }
> = {
  fact: { label: 'Fact', short: 'Facts', icon: FileText },
  source_pref: { label: 'Source preference', short: 'Source pref', icon: Globe },
  reasoning_trace: {
    label: 'Reasoning hint',
    short: 'Reasoning',
    icon: GitCompare,
  },
  run_summary: { label: 'Summary finding', short: 'Summary', icon: BookMarked },
};

function splitContent(content: string): { title: string; sub: string } {
  const clean = content.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.+?[.:?!])\s+(.*)$/);
  if (m && m[1].length <= 90) return { title: m[1].trim(), sub: m[2].trim() };
  if (clean.length <= 90) return { title: clean, sub: '' };
  return { title: clean.slice(0, 88) + '…', sub: clean.slice(88).trim() };
}

function relTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? 'just now' : `${h}h ago`;
  }
  if (d === 1) return '1 day ago';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return '1 week ago';
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

function confTone(c: number) {
  if (c >= 0.85) return 'bg-emerald-500';
  if (c >= 0.6) return 'bg-amber-500';
  return 'bg-neutral-400';
}

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
      if (stats) setStats({ ...stats, total: stats.total - 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  };

  const tabs = [
    { key: null as string | null, label: 'All', icon: Layers },
    ...CATEGORIES.map((c) => ({
      key: c as string | null,
      label: CAT_META[c].short.toUpperCase(),
      icon: CAT_META[c].icon,
    })),
  ];

  return (
    <div className="relative min-h-[100dvh]">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-subtle))]">
              Knowledge
            </p>
            <h1 className="h-display mt-2 text-3xl font-bold text-[rgb(var(--fg))] sm:text-4xl">
              Agent memory
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-muted))]">
              Persistent entries the agent uses to improve future research.
              Memories are derived from your runs, feedback, and explicit
              teaching.
            </p>
            {!isSignedIn && (
              <p className="mt-2 text-xs text-[rgb(var(--fg-subtle))]">
                Durable long-term memory is available after sign-in. Anonymous
                sessions keep thread context in this browser only.
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-secondary">
              <Download size={15} />
              Export
            </button>
            <button type="button" className="btn-primary">
              <Plus size={16} />
              Teach a fact
            </button>
          </div>
        </div>

        {/* Category stat tabs */}
        <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const count =
              t.key === null
                ? (stats?.total ?? 0)
                : (stats?.by_category[t.key] ?? 0);
            const active = filter === t.key;
            return (
              <button
                key={t.key ?? 'all'}
                type="button"
                onClick={() => setFilter(t.key)}
                className={clsx(
                  'rounded-2xl border p-4 text-left transition-all',
                  active
                    ? 'border-black/[0.18] bg-[rgb(var(--bg-elevated))] shadow-sm dark:border-white/[0.18]'
                    : 'border-black/[0.07] bg-transparent hover:bg-black/[0.02] dark:border-white/[0.07] dark:hover:bg-white/[0.02]',
                )}
              >
                <div className="flex items-center justify-between">
                  <Icon
                    size={16}
                    className={clsx(
                      active
                        ? 'text-orange-600 dark:text-orange-400'
                        : 'text-[rgb(var(--fg-subtle))]',
                    )}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
                    {t.label}
                  </span>
                </div>
                <p className="h-display mt-3 text-2xl font-bold text-[rgb(var(--fg))]">
                  {count}
                </p>
              </button>
            );
          })}
        </div>

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

        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={26} className="animate-spin text-orange-500" />
          </div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Layers size={36} className="mb-4 text-[rgb(var(--fg-subtle))]" />
            <p className="text-sm text-[rgb(var(--fg-muted))]">
              {filter
                ? 'No memories in this category.'
                : 'No memories stored yet.'}
            </p>
          </div>
        )}

        {/* Entry rows */}
        {!loading && memories.length > 0 && (
          <div className="glass-panel-solid divide-y divide-black/[0.05] overflow-hidden rounded-2xl dark:divide-white/[0.05]">
            {memories.map((entry) => {
              const meta = CAT_META[entry.category] ?? {
                label: entry.category,
                short: entry.category,
                icon: FileText,
              };
              const Icon = meta.icon;
              const { title, sub } = splitContent(entry.content);
              const pct = Math.round(entry.confidence * 100);
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group flex items-center gap-5 px-5 py-4 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <div className="flex w-32 shrink-0 items-center gap-2 self-start pt-0.5">
                    <Icon
                      size={15}
                      className="shrink-0 text-[rgb(var(--fg-subtle))]"
                    />
                    <span className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {meta.label}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[rgb(var(--fg))]">
                      {title}
                    </p>
                    {sub && (
                      <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-subtle))]">
                        {sub}
                      </p>
                    )}
                  </div>
                  <div className="hidden w-28 shrink-0 items-center gap-2 sm:flex">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
                      <div
                        className={clsx(
                          'h-full rounded-full',
                          confTone(entry.confidence),
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {entry.confidence.toFixed(2)}
                    </span>
                  </div>
                  <span className="hidden w-24 shrink-0 text-right text-xs text-[rgb(var(--fg-subtle))] sm:block">
                    {relTime(entry.created_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={deletingId === entry.id}
                    className="shrink-0 rounded-lg p-2 text-[rgb(var(--fg-subtle))] opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                    title="Delete memory"
                  >
                    {deletingId === entry.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
