'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { listRuns, deleteRun } from '@/lib/api';
import { RunStatus, RunStatusValue } from '@/lib/types';
import { TEXT_CONFIG } from '@/lib/text-config';
import {
  Clock,
  Search,
  AlertCircle,
  Inbox,
  ArrowRight,
  RefreshCw,
  Trash2,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

const statusConfig: Record<
  RunStatusValue,
  { label: string; dotClass: string; chipClass: string; icon: typeof Clock }
> = {
  pending: {
    label: TEXT_CONFIG.history.status.pending,
    dotClass: 'bg-neutral-400',
    chipClass: 'chip-neutral',
    icon: Clock,
  },
  running: {
    label: TEXT_CONFIG.history.status.running,
    dotClass: 'bg-blue-400 animate-pulse',
    chipClass: 'chip-info',
    icon: Loader2,
  },
  completed: {
    label: TEXT_CONFIG.history.status.completed,
    dotClass: 'bg-emerald-400',
    chipClass: 'chip-success',
    icon: CheckCircle2,
  },
  failed: {
    label: TEXT_CONFIG.history.status.failed,
    dotClass: 'bg-red-400',
    chipClass: 'chip-error',
    icon: AlertTriangle,
  },
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return TEXT_CONFIG.history.justNow;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function SkeletonCard() {
  return (
    <div className="glass-panel-solid rounded-2xl p-5 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-black/[0.06] dark:bg-white/[0.06]" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="h-4 w-3/4 bg-black/[0.06] dark:bg-white/[0.06] rounded-lg" />
          <div className="h-3 w-1/3 bg-black/[0.04] dark:bg-white/[0.04] rounded-lg" />
        </div>
        <div className="h-6 w-20 bg-black/[0.06] dark:bg-white/[0.06] rounded-full" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center py-24 px-6"
    >
      <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/15 mb-6">
        <Inbox size={32} strokeWidth={1.5} className="text-orange-500/60" />
      </div>
      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
        {TEXT_CONFIG.history.emptyTitle}
      </h3>
      <p className="text-sm text-neutral-500 text-center max-w-sm mb-8 leading-relaxed">
        {TEXT_CONFIG.history.emptyDescription}
      </p>
      <Link href="/" className="btn-primary">
        <Sparkles size={16} />
        {TEXT_CONFIG.history.startResearch}
      </Link>
    </motion.div>
  );
}

function DeleteDialog({
  run,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  run: RunStatus;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', bounce: 0.2 }}
        className="glass-panel-solid rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
              {TEXT_CONFIG.history.deleteRunTitle}
            </h3>
            <p className="text-xs text-neutral-500">{TEXT_CONFIG.history.deleteRunSubtitle}</p>
          </div>
        </div>

        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
          {TEXT_CONFIG.history.deleteRunPrompt}{' '}
          <span className="font-medium text-neutral-900 dark:text-white">
            &ldquo;{truncate(run.query, 60)}&rdquo;
          </span>
          .
        </p>

        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="btn-ghost" disabled={isDeleting}>
            {TEXT_CONFIG.history.cancel}
          </button>
          <button onClick={onConfirm} className="btn-danger" disabled={isDeleting}>
            {isDeleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            {isDeleting ? TEXT_CONFIG.history.deleting : TEXT_CONFIG.history.delete}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RunCard({
  run,
  index,
  onDelete,
}: {
  run: RunStatus;
  index: number;
  onDelete: (run: RunStatus) => void;
}) {
  const config = statusConfig[run.status];
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      layout
    >
      <Link
        href={`/runs/${run.run_id}`}
        className="group relative flex items-start gap-4 rounded-2xl glass-panel-solid p-4 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.2] hover:-translate-y-[1px] transition-all duration-300 sm:p-5"
      >
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${run.status === 'completed'
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : run.status === 'running'
              ? 'bg-blue-500/10 border border-blue-500/20'
              : run.status === 'failed'
                ? 'bg-red-500/10 border border-red-500/20'
                : 'bg-neutral-500/10 border border-neutral-500/20'
            }`}
        >
          <StatusIcon
            size={16}
            strokeWidth={2}
            className={`${run.status === 'completed'
              ? 'text-emerald-500'
              : run.status === 'running'
                ? 'text-blue-500 animate-spin'
                : run.status === 'failed'
                  ? 'text-red-500'
                  : 'text-neutral-400'
              }`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
            {truncate(run.query, 75)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className={config.chipClass}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
              {config.label}
            </span>
            <span className="text-[11px] text-neutral-400 dark:text-neutral-600 font-mono">
              {run.run_id.slice(0, 8)}
            </span>
            {run.iteration > 0 && (
              <span className="text-[11px] text-neutral-500">
                {run.iteration}
                {run.max_iterations > 0 ? `/${run.max_iterations}` : ''} iter
              </span>
            )}
            <span className="text-[11px] text-neutral-400 dark:text-neutral-600">
              {formatDate(run.created_at)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(run);
            }}
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/[0.08] transition-all duration-200"
            title={TEXT_CONFIG.history.deleteRunButtonTitle}
          >
            <Trash2 size={14} />
          </button>
          <ArrowRight
            size={16}
            strokeWidth={2}
            className="text-neutral-300 dark:text-neutral-700 group-hover:text-orange-500 dark:group-hover:text-orange-400 group-hover:translate-x-0.5 transition-all duration-200"
          />
        </div>
      </Link>
    </motion.div>
  );
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RunStatus | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRuns(50, 0);
      setRuns(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : TEXT_CONFIG.history.loadFailed,
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleDelete = useCallback(async (run: RunStatus) => {
    setIsDeleting(true);
    try {
      await deleteRun(run.run_id);
      setRuns((prev) => prev.filter((r) => r.run_id !== run.run_id));
      setDeleteTarget(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : TEXT_CONFIG.history.deleteFailed,
      );
    } finally {
      setIsDeleting(false);
    }
  }, []);

  const filteredRuns = searchFilter
    ? runs.filter((r) =>
      r.query.toLowerCase().includes(searchFilter.toLowerCase()),
    )
    : runs;

  return (
    <div className="flex min-h-screen flex-col px-3 pb-8 pt-16 sm:px-8 sm:pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="shrink-0 pb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 border border-neutral-200/60 dark:from-white/[0.06] dark:to-white/[0.02] dark:border-white/[0.08]">
            <Clock size={17} strokeWidth={1.75} className="text-neutral-600 dark:text-neutral-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-white">{TEXT_CONFIG.history.title}</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-600">{TEXT_CONFIG.history.subtitle}</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="shrink-0 flex flex-wrap items-center gap-3 pb-5"
      >
        <div className="relative flex-1 max-w-md">
          <Search
            size={15}
            strokeWidth={2}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="text"
            placeholder={TEXT_CONFIG.history.filterPlaceholder}
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="glass-input pl-9 pr-4"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          onClick={fetchRuns}
          disabled={isLoading}
          className="btn-secondary"
          title={TEXT_CONFIG.history.refreshTitle}
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            className={isLoading ? 'animate-spin' : ''}
          />
          {TEXT_CONFIG.history.refresh}
        </button>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-5 flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            <AlertCircle size={16} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filteredRuns.length === 0 && runs.length === 0 ? (
          <EmptyState />
        ) : filteredRuns.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <Search size={28} strokeWidth={1.5} className="text-neutral-300 dark:text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-500">
              {TEXT_CONFIG.history.noRunsMatchPrefix} &ldquo;{searchFilter}&rdquo;
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {filteredRuns.map((run, index) => (
                <RunCard
                  key={run.run_id}
                  run={run}
                  index={index}
                  onDelete={setDeleteTarget}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {deleteTarget && (
          <DeleteDialog
            run={deleteTarget}
            onConfirm={() => handleDelete(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
            isDeleting={isDeleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
