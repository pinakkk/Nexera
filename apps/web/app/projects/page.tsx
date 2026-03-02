'use client';

import { FolderOpen, Layers, Tag, BarChart3, ArrowRight } from 'lucide-react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Planned features for the Projects page                             */
/* ------------------------------------------------------------------ */

const plannedFeatures = [
  {
    icon: Layers,
    title: 'Organize Research',
    description:
      'Group related research runs into projects for easier navigation and context.',
  },
  {
    icon: Tag,
    title: 'Tags & Labels',
    description:
      'Categorize projects with custom tags to quickly find what you need.',
  },
  {
    icon: BarChart3,
    title: 'Project Insights',
    description:
      'Track research progress across a project with aggregated metrics and timelines.',
  },
];

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function ProjectsPage() {
  return (
    <div className="flex min-h-screen flex-col px-4 pb-8 pt-6 sm:px-8 sm:pt-8">
      {/* Header */}
      <div className="shrink-0 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <FolderOpen
            size={20}
            strokeWidth={1.75}
            className="text-neutral-500 dark:text-neutral-400"
          />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Projects</h1>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-500 ml-8">
          Organize your research into collections.
        </p>
      </div>

      {/* Coming soon card */}
      <div className="flex flex-1 items-start justify-center pt-8">
        <div className="w-full max-w-2xl">
          {/* Main banner */}
          <div className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-2xl p-10 text-center mb-6">
            <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-orange-500/10 border border-orange-500/20 mx-auto mb-6">
              <FolderOpen
                size={36}
                strokeWidth={1.5}
                className="text-orange-500"
              />
            </div>

              <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Coming Soon</h2>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm leading-relaxed max-w-md mx-auto mb-8">
              Projects will let you organize research runs into named
              collections, making it easy to revisit related findings, share
              context across runs, and build a structured knowledge base over
              time.
            </p>

            <div className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              Under Development
            </div>
          </div>

          {/* Planned features grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {plannedFeatures.map((feature) => (
              <div
                key={feature.title}
                className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-xl p-5"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.06] mb-4">
                  <feature.icon
                    size={18}
                    strokeWidth={1.75}
                    className="text-neutral-500 dark:text-neutral-400"
                  />
                </div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-1.5">
                  {feature.title}
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-2xl p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-white">
                Start a new research run in the meantime
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-500 mt-1">
                Your runs will be automatically available for projects once the feature launches.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 hover:bg-orange-500 rounded-xl transition-colors shrink-0 ml-4"
            >
              New Research
              <ArrowRight size={16} strokeWidth={2} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
