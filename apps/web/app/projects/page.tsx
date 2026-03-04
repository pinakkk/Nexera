'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  FolderOpen,
  Layers,
  Tag,
  BarChart3,
  ArrowRight,
  Sparkles,
  GitBranch,
  Share2,
  BookOpen,
} from 'lucide-react';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ------------------------------------------------------------------ */
/*  Feature cards                                                       */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Layers,
    gradient: 'from-orange-500/10 to-amber-500/5',
    iconColor: 'text-orange-500',
    borderColor: 'border-orange-500/15',
  },
  {
    icon: Tag,
    gradient: 'from-sky-500/10 to-blue-500/5',
    iconColor: 'text-sky-500',
    borderColor: 'border-sky-500/15',
  },
  {
    icon: BarChart3,
    gradient: 'from-emerald-500/10 to-green-500/5',
    iconColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/15',
  },
  {
    icon: GitBranch,
    gradient: 'from-purple-500/10 to-violet-500/5',
    iconColor: 'text-purple-500',
    borderColor: 'border-purple-500/15',
  },
  {
    icon: Share2,
    gradient: 'from-pink-500/10 to-rose-500/5',
    iconColor: 'text-pink-500',
    borderColor: 'border-pink-500/15',
  },
  {
    icon: BookOpen,
    gradient: 'from-cyan-500/10 to-teal-500/5',
    iconColor: 'text-cyan-500',
    borderColor: 'border-cyan-500/15',
  },
];
const featureText = TEXT_CONFIG.projects.features;

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function ProjectsPage() {
  return (
    <div className="flex min-h-screen flex-col px-4 pb-8 pt-16 sm:px-8 sm:pt-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="shrink-0 pb-8"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 border border-neutral-200/60 dark:from-white/[0.06] dark:to-white/[0.02] dark:border-white/[0.08]">
            <FolderOpen size={17} strokeWidth={1.75} className="text-neutral-600 dark:text-neutral-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-white">
              {TEXT_CONFIG.projects.title}
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-600">
              {TEXT_CONFIG.projects.subtitle}
            </p>
          </div>
        </div>
      </motion.div>

      <div className="flex flex-1 items-start justify-center">
        <div className="w-full max-w-3xl">
          {/* Hero Banner */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="glass-panel-solid rounded-3xl p-8 sm:p-12 text-center mb-8 relative overflow-hidden"
          >
            {/* Background decoration */}
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/[0.03] via-transparent to-blue-500/[0.02] dark:from-orange-500/[0.05] dark:to-blue-500/[0.03]" />
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-orange-500/[0.06] to-transparent rounded-full blur-3xl" />

            <div className="relative z-10">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2, type: 'spring', bounce: 0.3 }}
                className="flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-xl shadow-orange-500/25 mx-auto mb-6"
              >
                <FolderOpen size={32} strokeWidth={1.5} className="text-white" />
              </motion.div>

              <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900 dark:text-white mb-3 h-display">
                {TEXT_CONFIG.projects.heroTitle}
              </h2>
              <p className="text-neutral-600 dark:text-neutral-400 text-sm sm:text-base leading-relaxed max-w-lg mx-auto mb-8">
                {TEXT_CONFIG.projects.heroDescription}
              </p>

              <div className="chip-accent pulse-glow inline-flex">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                {TEXT_CONFIG.projects.underDevelopment}
              </div>
            </div>
          </motion.div>

          {/* Feature Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {features.map((feature, index) => (
              <motion.div
                key={featureText[index]?.title ?? String(index)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + index * 0.06 }}
                className={`glass-panel-solid rounded-2xl p-5 group hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.2] hover:-translate-y-0.5 transition-all duration-300`}
              >
                <div className={`flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br ${feature.gradient} border ${feature.borderColor} mb-4 group-hover:scale-105 transition-transform duration-300`}>
                  <feature.icon
                    size={18}
                    strokeWidth={1.75}
                    className={feature.iconColor}
                  />
                </div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white mb-1.5">
                  {featureText[index]?.title ?? ''}
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-500 leading-relaxed">
                  {featureText[index]?.description ?? ''}
                </p>
              </motion.div>
            ))}
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.6 }}
            className="glass-panel-solid rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                {TEXT_CONFIG.projects.ctaTitle}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-1">
                {TEXT_CONFIG.projects.ctaDescription}
              </p>
            </div>
            <Link href="/" className="btn-primary shrink-0">
              <Sparkles size={16} />
              {TEXT_CONFIG.projects.ctaButton}
              <ArrowRight size={14} />
            </Link>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
