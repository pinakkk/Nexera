'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Info,
  Shield,
} from 'lucide-react';
import clsx from 'clsx';
import { listTrustedSources, addTrustedSource, removeTrustedSource } from '@/lib/api';

interface TrustedSource {
  id: string;
  domain: string;
  label: string | null;
  trust_level: number;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<TrustedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form state
  const [domain, setDomain] = useState('');
  const [label, setLabel] = useState('');
  const [trustLevel, setTrustLevel] = useState(0.8);
  const [adding, setAdding] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTrustedSources();
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = domain.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      await addTrustedSource(trimmed, label.trim() || undefined, trustLevel);
      setDomain('');
      setLabel('');
      setTrustLevel(0.8);
      await fetchSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (sourceId: string) => {
    if (deletingId) return;
    setDeletingId(sourceId);
    try {
      await removeTrustedSource(sourceId);
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove source');
    } finally {
      setDeletingId(null);
    }
  };

  function trustColor(level: number): string {
    if (level >= 0.8) return 'text-emerald-400';
    if (level >= 0.5) return 'text-amber-400';
    return 'text-neutral-500 dark:text-zinc-400';
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-white dark:bg-[#0a0a0a]">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-zinc-100 sm:text-3xl">Trusted Sources</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-zinc-400">
            Manage domains that the research agent should prioritize and trust.
          </p>
        </div>

        {/* Info card */}
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-blue-500/15 bg-blue-500/[0.05] p-4 text-sm text-blue-300/80">
          <Info size={18} className="mt-0.5 shrink-0 text-blue-400" />
          <p>
            Trusted sources are domains the agent will prioritize when searching and citing.
            Higher trust levels cause the agent to prefer content from these domains and weight
            their information more heavily in the final report.
          </p>
        </div>

        {/* Add source form */}
        <form
          onSubmit={handleAdd}
          className="mb-8 rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-5"
        >
          <h2 className="mb-4 text-sm font-semibold text-neutral-800 dark:text-zinc-200">Add New Source</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400 dark:text-zinc-500">Domain *</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. arxiv.org"
                required
                className="w-full rounded-lg border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 px-3 py-2 text-sm text-neutral-900 dark:text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-orange-500/40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-400 dark:text-zinc-500">Label (optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Academic papers"
                className="w-full rounded-lg border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 px-3 py-2 text-sm text-neutral-900 dark:text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-orange-500/40"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={adding || !domain.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add
              </button>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 flex items-center justify-between text-xs text-neutral-400 dark:text-zinc-500">
              <span>Trust Level</span>
              <span className={clsx('font-mono font-medium', trustColor(trustLevel))}>
                {trustLevel.toFixed(2)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={trustLevel}
              onChange={(e) => setTrustLevel(parseFloat(e.target.value))}
              className="w-full accent-orange-500"
            />
            <div className="mt-1 flex justify-between text-[10px] text-neutral-500 dark:text-zinc-600">
              <span>Low trust</span>
              <span>High trust</span>
            </div>
          </div>
        </form>

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
        {!loading && !error && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Shield size={40} className="mb-4 text-zinc-700" />
            <p className="text-neutral-500 dark:text-zinc-400">No trusted sources yet. Add one above to get started.</p>
          </div>
        )}

        {/* Sources list */}
        {!loading && sources.length > 0 && (
          <div className="space-y-2">
            {sources.map((source) => (
              <motion.div
                key={source.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/60 p-4 transition-colors hover:border-neutral-300 dark:hover:border-zinc-700"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-zinc-800/80">
                  <Globe size={16} className="text-neutral-500 dark:text-zinc-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 dark:text-zinc-100">{source.domain}</p>
                  {source.label && (
                    <p className="text-xs text-neutral-400 dark:text-zinc-500">{source.label}</p>
                  )}
                </div>
                <span
                  className={clsx(
                    'text-xs font-mono font-medium',
                    trustColor(source.trust_level),
                  )}
                >
                  {source.trust_level.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(source.id)}
                  disabled={deletingId === source.id}
                  className="shrink-0 rounded-lg p-2 text-neutral-500 dark:text-zinc-600 transition-all hover:bg-red-500/10 hover:text-red-400 opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Remove source"
                >
                  {deletingId === source.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
