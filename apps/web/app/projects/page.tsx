'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Layers,
  Tag,
  BarChart3,
  GitBranch,
  Users,
  BookOpen,
  Zap,
} from 'lucide-react';
import { TEXT_CONFIG } from '@/lib/text-config';

const featureIcons = [Layers, Tag, BarChart3, GitBranch, Users, BookOpen];
const featureText = TEXT_CONFIG.projects.features;

const ROADMAP = [
  {
    phase: 'Q2 · now',
    state: 'SHIPPED',
    stateCls: 'chip-success',
    dot: 'bg-[rgb(var(--fg))]',
    items: ['New research', 'History', 'Sources', 'Memory beta'],
  },
  {
    phase: 'Q3 · next',
    state: 'IN PROGRESS',
    stateCls: 'chip-accent',
    dot: 'bg-orange-500',
    items: ['Projects · cluster runs', 'Tags & labels', 'Project insights'],
  },
  {
    phase: 'Q4',
    state: 'PLANNED',
    stateCls: 'chip-neutral',
    dot: 'border border-black/20 dark:border-white/20',
    items: ['Version history', 'Diff view', 'Collaboration'],
  },
  {
    phase: '2027',
    state: 'PLANNED',
    stateCls: 'chip-neutral',
    dot: 'border border-black/20 dark:border-white/20',
    items: ['Knowledge base', 'API access', 'Workspace SSO'],
  },
];

export default function ProjectsPage() {
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
              {TEXT_CONFIG.projects.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[rgb(var(--fg-muted))]">
              Organize research runs into named collections. Build a structured
              knowledge base your team can navigate.
            </p>
          </div>
          <span className="chip-accent shrink-0 font-mono">
            BETA · EARLY ACCESS
          </span>
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="glass-panel-solid relative mb-14 overflow-hidden rounded-3xl p-8 sm:p-12"
        >
          <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-gradient-to-bl from-orange-500/[0.07] to-transparent blur-3xl" />
          <div className="relative z-10 flex flex-col gap-8 sm:flex-row sm:items-center">
            <div className="flex-1">
              <span className="chip-accent mb-5 inline-flex font-mono">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500" />
                shipping Q3
              </span>
              <h2 className="h-display max-w-sm text-3xl font-bold text-[rgb(var(--fg))] sm:text-4xl">
                A home for related research.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                Group runs by topic, share context between them, compare report
                versions over time, and invite collaborators into a single
                workspace.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/" className="btn-primary">
                  <Zap size={16} />
                  Join the beta
                </Link>
                <button type="button" className="btn-secondary">
                  <BookOpen size={15} />
                  Read changelog
                </button>
              </div>
            </div>
            {/* Stacked-cards illustration */}
            <div className="relative hidden h-44 w-72 shrink-0 sm:block">
              <div className="absolute right-2 top-1 h-36 w-60 rotate-[6deg] rounded-2xl border border-black/[0.06] bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03]" />
              <div className="absolute right-5 top-3 h-36 w-60 rotate-[-3deg] rounded-2xl border border-black/[0.06] bg-white/80 dark:border-white/[0.06] dark:bg-white/[0.04]" />
              <div className="absolute right-0 top-6 h-36 w-60 rounded-2xl border border-black/[0.1] bg-[rgb(var(--bg-elevated))] p-5 shadow-lg dark:border-white/[0.1]">
                <div className="flex items-center justify-between">
                  <div className="h-2.5 w-24 rounded-full bg-[rgb(var(--fg))]/80" />
                  <span className="chip-accent font-mono text-[9px]">PHARMA</span>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-2 w-full rounded-full bg-black/[0.07] dark:bg-white/[0.07]" />
                  <div className="h-2 w-5/6 rounded-full bg-black/[0.07] dark:bg-white/[0.07]" />
                  <div className="h-2 w-2/3 rounded-full bg-black/[0.07] dark:bg-white/[0.07]" />
                </div>
                <div className="mt-4 h-7 w-full rounded-lg bg-black/[0.04] dark:bg-white/[0.04]" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* What's coming */}
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-subtle))]">
          What&apos;s coming
        </p>
        <div className="mb-14 grid grid-cols-1 overflow-hidden rounded-2xl border border-black/[0.07] dark:border-white/[0.07] sm:grid-cols-2 lg:grid-cols-3">
          {featureText.map((f, i) => {
            const Icon = featureIcons[i] ?? Layers;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="border-b border-r border-black/[0.07] bg-[rgb(var(--bg-elevated))] p-6 transition-colors last:border-b-0 hover:bg-black/[0.02] dark:border-white/[0.07] dark:hover:bg-white/[0.02]"
              >
                <Icon
                  size={20}
                  strokeWidth={1.75}
                  className="mb-4 text-[rgb(var(--fg-muted))]"
                />
                <h3 className="text-[15px] font-bold text-[rgb(var(--fg))]">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  {f.description}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Roadmap */}
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-subtle))]">
          Roadmap
        </p>
        <div className="relative pl-6">
          <div className="absolute bottom-2 left-[5px] top-2 w-px bg-black/[0.1] dark:bg-white/[0.1]" />
          <div className="space-y-8">
            {ROADMAP.map((r) => (
              <div key={r.phase} className="relative">
                <span
                  className={`absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full ${r.dot}`}
                />
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[rgb(var(--fg))]">
                    {r.phase}
                  </span>
                  <span className={`${r.stateCls} font-mono`}>{r.state}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-lg border border-black/[0.08] bg-white/60 px-3 py-1.5 text-xs text-[rgb(var(--fg-muted))] dark:border-white/[0.08] dark:bg-white/[0.03]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
