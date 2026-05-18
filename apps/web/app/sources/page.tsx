'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Shield,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  listTrustedSources,
  addTrustedSource,
  removeTrustedSource,
} from '@/lib/api';

interface TrustedSource {
  id: string;
  domain: string;
  label: string | null;
  trust_level: number;
}

/* Derive a "kind" bucket from domain/label since the model only stores
   domain + label + trust. Used purely for the filter chips. */
function kindOf(s: TrustedSource): 'paper' | 'gov' | 'news' | 'blog' {
  const d = s.domain.toLowerCase();
  const l = (s.label ?? '').toLowerCase();
  if (d.endsWith('.gov') || /gov|filing|regulat/.test(l)) return 'gov';
  if (/arxiv|nature|ssrn|pubmed|\.edu|journal|paper|preprint/.test(d + l))
    return 'paper';
  if (/blog|essay|medium|substack/.test(d + l)) return 'blog';
  if (/news|reuters|bloomberg|ft\.|times|wsj|wire/.test(d + l)) return 'news';
  return 'news';
}

const KIND_LABELS: Record<string, string> = {
  paper: 'paper',
  gov: 'gov',
  news: 'news',
  blog: 'blog',
};

type Filter = 'all' | 'paper' | 'gov' | 'news' | 'blog';

function trustTone(level: number) {
  if (level >= 0.85)
    return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' };
  if (level >= 0.6)
    return { text: 'text-amber-600 dark:text-amber-500', bar: 'bg-amber-500' };
  return { text: 'text-[rgb(var(--fg-subtle))]', bar: 'bg-neutral-400' };
}

export default function SourcesPage() {
  const [sources, setSources] = useState<TrustedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [panelOpen, setPanelOpen] = useState(false);

  const [domain, setDomain] = useState('');
  const [label, setLabel] = useState('');
  const [trustLevel, setTrustLevel] = useState(0.8);
  const [adding, setAdding] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSources(await listTrustedSources());
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
      setPanelOpen(false);
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

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: sources.length,
      paper: 0,
      gov: 0,
      news: 0,
      blog: 0,
    };
    for (const s of sources) c[kindOf(s)]++;
    return c;
  }, [sources]);

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? sources
        : sources.filter((s) => kindOf(s) === filter),
    [sources, filter],
  );

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paper', label: 'Papers' },
    { key: 'gov', label: 'Government' },
    { key: 'news', label: 'News' },
    { key: 'blog', label: 'Blogs' },
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
              Trusted sources
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-muted))]">
              Domains the agent prioritizes when searching and citing. Higher
              trust weights the source more heavily in the final report.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="btn-primary shrink-0"
          >
            <Plus size={16} />
            Add source
          </button>
        </div>

        {/* Filter tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-1 border-b border-black/[0.07] pb-3 dark:border-white/[0.07]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
                filter === t.key
                  ? 'bg-[rgb(var(--fg))] text-[rgb(var(--bg-elevated))]'
                  : 'text-[rgb(var(--fg-muted))] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
              )}
            >
              {t.label}
              <span
                className={clsx(
                  'font-mono text-[10px]',
                  filter === t.key
                    ? 'text-[rgb(var(--bg-elevated))]/70'
                    : 'text-[rgb(var(--fg-subtle))]',
                )}
              >
                {counts[t.key]}
              </span>
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

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Shield size={36} className="mb-4 text-[rgb(var(--fg-subtle))]" />
            <p className="text-sm text-[rgb(var(--fg-muted))]">
              {sources.length === 0
                ? 'No trusted sources yet. Add one to get started.'
                : 'No sources in this category.'}
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && filtered.length > 0 && (
          <div className="glass-panel-solid overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[1fr_5rem_8rem_2.5rem] items-center gap-4 border-b border-black/[0.07] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))] dark:border-white/[0.07] sm:grid-cols-[1fr_6rem_10rem_2.5rem]">
              <span>Domain</span>
              <span>Kind</span>
              <span>Trust</span>
              <span />
            </div>
            <div className="divide-y divide-black/[0.05] dark:divide-white/[0.05]">
              {filtered.map((s) => {
                const tone = trustTone(s.trust_level);
                const initial = s.domain.charAt(0).toUpperCase();
                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group grid grid-cols-[1fr_5rem_8rem_2.5rem] items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:grid-cols-[1fr_6rem_10rem_2.5rem]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/[0.08] font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[rgb(var(--fg))]">
                          {s.domain}
                        </p>
                        {s.label && (
                          <p className="truncate text-xs text-[rgb(var(--fg-subtle))]">
                            {s.label}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
                      {KIND_LABELS[kindOf(s)]}
                    </span>
                    <div className="flex items-center gap-2.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
                        <div
                          className={clsx('h-full rounded-full', tone.bar)}
                          style={{
                            width: `${Math.round(s.trust_level * 100)}%`,
                          }}
                        />
                      </div>
                      <span
                        className={clsx(
                          'w-9 text-right font-mono text-xs font-medium',
                          tone.text,
                        )}
                      >
                        {s.trust_level.toFixed(2)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      className="justify-self-end rounded-lg p-2 text-[rgb(var(--fg-subtle))] opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                      title="Remove source"
                    >
                      {deletingId === s.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-5 text-xs text-[rgb(var(--fg-subtle))]">
          The agent will still search outside this list, but trusted sources
          are upweighted in ranking and citation selection. Set trust below{' '}
          <span className="font-mono">0.5</span> to{' '}
          <em>downweight</em> rather than block a domain.
        </p>
      </div>

      {/* Add-source slide-over */}
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPanelOpen(false)}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-black/[0.08] bg-[rgb(var(--bg-elevated))] p-7 dark:border-white/[0.08]"
            >
              <div className="mb-6 flex items-center justify-between">
                <h2 className="h-display text-xl font-bold text-[rgb(var(--fg))]">
                  Add trusted source
                </h2>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="btn-ghost p-2"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAdd} className="flex flex-col gap-5">
                <div>
                  <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
                    Domain *
                  </label>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="e.g. arxiv.org"
                    required
                    className="glass-input"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
                    Label
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Academic preprints"
                    className="glass-input"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
                    <span>Trust level</span>
                    <span
                      className={clsx(
                        'font-medium',
                        trustTone(trustLevel).text,
                      )}
                    >
                      {trustLevel.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={trustLevel}
                    onChange={(e) =>
                      setTrustLevel(parseFloat(e.target.value))
                    }
                    className="w-full accent-orange-500"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-[rgb(var(--fg-subtle))]">
                    <span>Downweight</span>
                    <span>Strongly prefer</span>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={adding || !domain.trim()}
                  className="btn-primary mt-2 w-full disabled:opacity-50"
                >
                  {adding ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Plus size={15} />
                  )}
                  Add source
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
