'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ResearchInput } from '@/components/ResearchInput';
import { createRun, ingestSources, ingestSourceUrls } from '@/lib/api';
import { RunConstraints } from '@/lib/types';
import { Sparkles, X, Zap, Brain, Shield, Globe } from 'lucide-react';

const FEATURES = [
  {
    icon: Zap,
    title: 'Parallel Research',
    desc: 'Multiple search workers run simultaneously',
  },
  {
    icon: Brain,
    title: 'Knowledge Graph',
    desc: 'Auto-builds entity relationships',
  },
  {
    icon: Shield,
    title: 'Verified Claims',
    desc: 'CoVe pipeline fact-checks every claim',
  },
  {
    icon: Globe,
    title: 'Academic + Web',
    desc: 'Searches papers, journals, and the web',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    query: string,
    constraints: RunConstraints,
    extras: { files: File[]; urls: string[] },
  ) {
    setIsLoading(true);
    setError(null);

    try {
      if (extras.files.length > 0) {
        await ingestSources(extras.files);
      }

      if (extras.urls.length > 0) {
        await ingestSourceUrls(extras.urls);
      }

      const { run_id } = await createRun(query, constraints);
      router.push(`/runs/${run_id}`);
    } catch (err) {
      console.error('[HomePage] Failed to start run', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start research. Please try again.',
      );
      setIsLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 pb-10 pt-16 sm:px-6 sm:pt-16">
      {/* Background gradient orbs */}
      <div className="pointer-events-none absolute left-1/2 top-[15%] h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/[0.08] to-amber-500/[0.04] blur-[80px] sm:top-[18%] sm:h-[500px] sm:w-[500px]" />
      <div className="pointer-events-none absolute right-[10%] top-[45%] h-[250px] w-[250px] rounded-full bg-gradient-to-br from-blue-500/[0.04] to-sky-500/[0.02] blur-[60px] sm:h-[350px] sm:w-[350px]" />
      <div className="pointer-events-none absolute left-[5%] top-[60%] h-[200px] w-[200px] rounded-full bg-gradient-to-br from-purple-500/[0.03] to-violet-500/[0.02] blur-[50px]" />

      <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-5xl flex-col items-center justify-center">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          className="mb-10 flex flex-col items-center text-center"
        >
          {/* Brand icon */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1, type: 'spring', bounce: 0.4 }}
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/25"
          >
            <Sparkles size={26} strokeWidth={2} className="text-white" />
          </motion.div>

          <h1 className="h-display text-3xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-5xl">
            Nexara
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400 sm:mt-4 sm:text-base">
            Your AI-powered autonomous research agent — searches the web,
            builds knowledge graphs, verifies claims, and delivers comprehensive reports.
          </p>
        </motion.div>

        {/* Research Input */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full"
        >
          <ResearchInput onSubmit={handleSubmit} isLoading={isLoading} />
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 w-full max-w-3xl flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 w-full max-w-3xl"
        >
          {FEATURES.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 + i * 0.08 }}
              className="flex items-center gap-2.5 rounded-xl glass-panel-solid px-3.5 py-3 group hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/[0.04] dark:hover:shadow-black/[0.2] transition-all duration-300"
            >
              <feat.icon
                size={16}
                strokeWidth={1.75}
                className="text-orange-500/70 shrink-0 group-hover:text-orange-500 transition-colors"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 truncate">
                  {feat.title}
                </p>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-600 truncate">
                  {feat.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
