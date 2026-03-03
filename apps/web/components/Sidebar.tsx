'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Clock,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Search,
  X,
  Sparkles,
} from 'lucide-react';
import { useTheme } from './theme';
import { listRuns } from '@/lib/api';
import type { RunStatus } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Nav configuration                                                  */
/* ------------------------------------------------------------------ */

const NAV_ITEMS = [
  { href: '/', icon: Plus, label: 'New Research', id: 'nav-new' },
  { href: '/history', icon: Clock, label: 'History', id: 'nav-history' },
  { href: '/projects', icon: FolderOpen, label: 'Projects', id: 'nav-projects' },
  { href: '/settings', icon: Settings, label: 'Settings', id: 'nav-settings' },
];

/* ------------------------------------------------------------------ */
/*  Sidebar component                                                  */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRuns, setRecentRuns] = useState<RunStatus[]>([]);

  useEffect(() => {
    listRuns(8, 0).then(setRecentRuns).catch(() => { });
  }, []);

  const filteredRuns = useMemo(() => {
    if (!searchQuery) return recentRuns.slice(0, 5);
    return recentRuns.filter((r) =>
      r.query.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [searchQuery, recentRuns]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  /* ---- Shared content ---- */
  const content = (
    <div className="flex h-full flex-col">
      {/* Logo / Brand */}
      <div className="flex items-center pl-[13px] pt-5 pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-md shadow-orange-500/20">
          <Sparkles size={16} className="text-white" strokeWidth={2.5} />
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-black/[0.12] to-transparent dark:via-white/[0.12]" />

      {/* Navigation */}
      <nav className="flex-1 px-2.5 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ href, icon: Icon, label, id }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              id={id}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${active
                ? 'text-orange-600 dark:text-orange-400'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                }`}
            >
              {active && (
                <>
                  <motion.div
                    layoutId="sidebar-active-bg"
                    className="absolute inset-0 rounded-xl bg-orange-500/[0.08]"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                  <motion.div
                    layoutId="sidebar-active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-orange-500 to-orange-600"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                </>
              )}
              <Icon
                size={18}
                strokeWidth={active ? 2.25 : 1.75}
                className={`relative z-10 shrink-0 transition-transform duration-200 group-hover:scale-105 ${active ? 'text-orange-600 dark:text-orange-400' : ''
                  }`}
              />
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="relative z-10 overflow-hidden whitespace-nowrap pl-3"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* Search Toggle */}
        {!collapsed && (
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-500 dark:text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-neutral-700 dark:hover:text-neutral-300 transition-all"
          >
            <Search size={18} strokeWidth={1.75} className="shrink-0 group-hover:scale-105 transition-transform" />
            <span className="whitespace-nowrap pl-3">Search Runs</span>
          </button>
        )}

        {/* Inline Search */}
        <AnimatePresence>
          {searchOpen && !collapsed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="relative px-1 pt-1">
                <Search
                  size={14}
                  className="absolute left-3.5 top-[13px] text-neutral-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter runs..."
                  autoFocus
                  className="glass-input pl-8 pr-8 py-2 text-xs !rounded-lg"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-[12px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Search results */}
              <div className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
                {filteredRuns.map((run) => (
                  <Link
                    key={run.run_id}
                    href={`/runs/${run.run_id}`}
                    onClick={onCloseMobile}
                    className="flex flex-col gap-0.5 px-3 py-2 rounded-lg text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate">
                      {run.query.slice(0, 45)}
                      {run.query.length > 45 ? '…' : ''}
                    </span>
                    <span className="text-neutral-400 dark:text-neutral-600 text-[10px]">
                      {run.status} · {run.run_id.slice(0, 8)}
                    </span>
                  </Link>
                ))}
                {filteredRuns.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-neutral-400">
                    No runs found
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Bottom controls */}
      <div className="mt-auto px-2.5 pb-4 pt-2 space-y-1">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-500 dark:text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-neutral-700 dark:hover:text-neutral-300 transition-all"
        >
          {theme === 'dark' ? (
            <Sun size={18} strokeWidth={1.75} className="shrink-0 group-hover:rotate-45 transition-transform duration-300" />
          ) : (
            <Moon size={18} strokeWidth={1.75} className="shrink-0 group-hover:-rotate-12 transition-transform duration-300" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap pl-3"
              >
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden md:flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 dark:text-neutral-600 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-neutral-600 dark:hover:text-neutral-400 transition-all"
        >
          {collapsed ? (
            <ChevronRight size={18} strokeWidth={1.75} className="shrink-0" />
          ) : (
            <ChevronLeft size={18} strokeWidth={1.75} className="shrink-0" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap pl-3"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 260 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="hidden md:flex shrink-0 h-screen sticky top-0 flex-col border-r border-black/[0.06] dark:border-white/[0.06] bg-white/50 dark:bg-[#0a0c12]/60 backdrop-blur-2xl backdrop-saturate-150 overflow-hidden"
      >
        {content}
      </motion.aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={onCloseMobile}
            />
            <motion.aside
              key="mobile-sidebar"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0.12, duration: 0.4 }}
              className="fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col border-r border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#0a0c12] shadow-2xl md:hidden"
            >
              {/* Close button */}
              <button
                onClick={onCloseMobile}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
