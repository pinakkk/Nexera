'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { handleSignOut } from '@/app/actions/auth';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  Trash2,
  MessageSquare,
  X,
  Clock,
  History,
  Globe,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import { useTheme } from './theme';
import { listRuns, deleteRun } from '@/lib/api';
import type { RunStatus } from '@/lib/types';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ------------------------------------------------------------------ */
/*  Nav configuration                                                  */
/* ------------------------------------------------------------------ */

const PRIMARY_NAV_ITEMS = [
  { href: '/', icon: Plus, label: TEXT_CONFIG.sidebar.nav.newResearch, id: 'nav-new' },
  { href: '/history', icon: History, label: 'History', id: 'nav-history' },
];

const SECONDARY_NAV_ITEMS = [
  { href: '/projects', icon: FolderOpen, label: TEXT_CONFIG.sidebar.nav.projects, id: 'nav-projects', badge: 'Beta' },
  { href: '/sources', icon: Globe, label: 'Sources', id: 'nav-sources' },
  { href: '/memory', icon: Cpu, label: 'Memory', id: 'nav-memory', badge: 'Beta' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRunDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

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
  const sidebarLogoSrc = theme === 'dark' ? '/assets/darksquare.png' : '/assets/square.png';
  const [recentRuns, setRecentRuns] = useState<RunStatus[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [continueRunId, setContinueRunId] = useState<string | null>(null);
  const router = useRouter();
  const { user } = useAuth();
  const isSignedIn = !!user;

  useEffect(() => {
    listRuns(20, 0).then(setRecentRuns).catch(() => { });
  }, [isSignedIn]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setContinueRunId(new URLSearchParams(window.location.search).get('continue'));
  }, [pathname, mobileOpen]);

  const handleDeleteRun = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat?')) return;

    try {
      setIsDeleting(id);
      await deleteRun(id);
      setRecentRuns((prev) => prev.filter((r) => r.run_id !== id));
      if (pathname === `/runs/${id}`) window.location.href = '/';
    } catch {
      alert('Failed to delete the run.');
    } finally {
      setIsDeleting(null);
    }
  };

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  /* ---- Desktop sidebar content ---- */
  const desktopContent = (
    <div className="flex h-full flex-col">
      {/* Logo + brand */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-2">
        <Image
          key={sidebarLogoSrc}
          src={sidebarLogoSrc}
          alt="Nexara"
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-xl object-contain"
          priority
        />
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="overflow-hidden whitespace-nowrap text-base font-semibold tracking-tight text-neutral-900 dark:text-white"
            >
              Nexara
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-5 my-3 h-px bg-black/[0.06] dark:bg-white/[0.08]" />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3">
        {!collapsed && (
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-500">
            Navigation
          </p>
        )}
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              id={item.id}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors duration-200 ${active
                ? 'text-orange-700 dark:text-orange-300'
                : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
            >
              {active && (
                <>
                  <motion.div
                    layoutId="sidebar-active-bg"
                    className="absolute inset-0 rounded-xl bg-orange-500/[0.08] dark:bg-orange-500/[0.12]"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                  <motion.div
                    layoutId="sidebar-active-dot"
                    className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-orange-500"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                </>
              )}
              <Icon
                size={18}
                strokeWidth={active ? 2.1 : 1.75}
                className={`relative z-10 shrink-0 transition-transform duration-200 group-hover:scale-105 ${active ? 'text-neutral-900 dark:text-white' : ''
                  }`}
              />
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                    className="relative z-10 overflow-hidden whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {!collapsed && (
          <p className="px-3 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-500">
            Workspace
          </p>
        )}
        {SECONDARY_NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              id={item.id}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors duration-200 ${active
                ? 'text-orange-700 dark:text-orange-300'
                : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
            >
              {active && (
                <>
                  <motion.div
                    layoutId="sidebar-secondary-active-bg"
                    className="absolute inset-0 rounded-xl bg-orange-500/[0.08] dark:bg-orange-500/[0.12]"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                  <motion.div
                    layoutId="sidebar-secondary-active-dot"
                    className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-orange-500"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                </>
              )}
              <Icon
                size={18}
                strokeWidth={active ? 2.1 : 1.75}
                className={`relative z-10 shrink-0 transition-transform duration-200 group-hover:scale-105 ${active ? 'text-neutral-900 dark:text-white' : ''
                  }`}
              />
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                    className="relative z-10 flex items-center gap-2 overflow-hidden whitespace-nowrap"
                  >
                    {item.label}
                    {'badge' in item && item.badge ? (
                      <span className="rounded-full border border-black/[0.08] bg-black/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-500">
                        {item.badge}
                      </span>
                    ) : null}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* Recent Chats Section */}
        {recentRuns.length > 0 && (
          <div className="mb-2 mt-6">
            {!collapsed && (
              <>
                <div className="mx-3 mb-3 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-400">
                  Research History
                </p>
              </>
            )}
            <div className="mt-1 space-y-0.5">
              {recentRuns.map((run) => {
                const isCurrentRun =
                  pathname === `/runs/${run.run_id}` || continueRunId === run.run_id;
                return (
                  <div
                    key={run.run_id}
                    className={`group relative flex items-center rounded-xl text-[13px] transition-all duration-200 ${isCurrentRun
                      ? 'bg-orange-500/[0.08] font-medium text-orange-700 dark:bg-orange-500/[0.12] dark:text-orange-300'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 hover:bg-black/[0.02] dark:hover:text-neutral-200 dark:hover:bg-white/[0.06]'
                      }`}
                  >
                    <Link
                      href={`/?continue=${run.run_id}`}
                      onClick={onCloseMobile}
                      className="flex-1 flex items-center gap-2.5 overflow-hidden min-w-0 px-3 py-2"
                    >
                      <MessageSquare size={14} strokeWidth={1.75} className="shrink-0 opacity-60" />
                      {!collapsed && (
                        <div className="min-w-0 flex-1">
                          <span className="block truncate max-w-[120px] leading-snug">
                            {run.query || 'Research run'}
                          </span>
                          {run.created_at && (
                            <span className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-600 mt-0.5">
                              <Clock size={9} />
                              {formatRunDate(run.created_at)}
                            </span>
                          )}
                        </div>
                      )}
                    </Link>
                    {!collapsed && (
                      <div className="flex items-center gap-0.5 shrink-0 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/?continue=${run.run_id}`); onCloseMobile(); }}
                          className="p-1 hover:bg-orange-100 dark:hover:bg-orange-500/20 rounded-md text-orange-500 hover:text-orange-600"
                          title="Continue chat"
                        >
                          <MessageSquare size={12} />
                        </button>
                        <Link
                          href={`/runs/${run.run_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded-md text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-neutral-700 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
                          title="View details"
                        >
                          <ExternalLink size={12} />
                        </Link>
                        <button
                          onClick={(e) => handleDeleteRun(e, run.run_id)}
                          disabled={isDeleting === run.run_id}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-md text-red-500 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom controls */}
      <div className="mt-auto space-y-0.5 px-3 pb-4 pt-2">
        <div className="mx-3 mb-2 h-px bg-black/[0.06] dark:bg-white/[0.08]" />

        {/* Auth */}
        <div className="flex w-full items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            {isSignedIn && user ? (
              <>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
                  {user.firstName?.charAt(0) || user.email?.charAt(0) || 'U'}
                </div>
                {!collapsed && (
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-[100px]">
                      {user.firstName || user.email?.split('@')[0] || 'Account'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <Link
                href="/sign-in"
                className="flex items-center gap-3 text-[13px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-200"
              >
                <LogIn size={17} strokeWidth={1.75} className="shrink-0" />
                {!collapsed && <span>Sign In</span>}
              </Link>
            )}
          </div>
          {isSignedIn && !collapsed && (
            <form action={handleSignOut}>
              <button
                type="submit"
                className="text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
                title="Log out"
              >
                <LogOut size={15} strokeWidth={2} />
              </button>
            </form>
          )}
        </div>

        {/* Settings */}
        <Link
          href="/settings"
          onClick={onCloseMobile}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-neutral-500 transition-all hover:bg-black/[0.03] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200"
        >
          <Settings size={17} strokeWidth={1.75} className="shrink-0 group-hover:rotate-45 transition-transform duration-300" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {TEXT_CONFIG.sidebar.nav.settings}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-neutral-400 transition-all hover:bg-black/[0.03] hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300 md:flex"
        >
          {collapsed ? (
            <ChevronRight size={17} strokeWidth={1.75} className="shrink-0" />
          ) : (
            <ChevronLeft size={17} strokeWidth={1.75} className="shrink-0" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {TEXT_CONFIG.sidebar.collapse}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );

  /* ---- Mobile sidebar content ---- */
  const mobileContent = (
    <div className="flex h-full flex-col">
      {/* Logo + Brand */}
      <div className="flex items-center gap-3 px-5 pb-2 pt-6">
        <Image
          key={sidebarLogoSrc}
          src={sidebarLogoSrc}
          alt="Nexara"
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-xl object-contain"
          priority
        />
        <div>
          <span className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
            Nexara
          </span>
          <p className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 tracking-wide uppercase">
            Research Agent
          </p>
        </div>
      </div>

      <div className="mx-5 my-3 h-px bg-black/[0.08] dark:bg-white/[0.08]" />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3">
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-400">
          Navigation
        </p>
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              id={`mobile-${item.id}`}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3.5 rounded-2xl px-4 py-3 text-[15px] font-medium tracking-[-0.01em] transition-all duration-200 ${active
                ? 'bg-black/[0.03] text-neutral-900 dark:bg-white/[0.06] dark:text-white'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]'
                }`}
            >
              {active && (
                <motion.div
                  layoutId="mobile-active-dot"
                  className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-orange-500"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                />
              )}
              <Icon
                size={20}
                strokeWidth={active ? 2.25 : 1.75}
                className={`relative z-10 shrink-0 ${active ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-500 dark:text-neutral-400'
                  }`}
              />
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}

        <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-400">
          Workspace
        </p>
        {SECONDARY_NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              id={`mobile-${item.id}`}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3.5 rounded-2xl px-4 py-3 text-[15px] font-medium tracking-[-0.01em] transition-all duration-200 ${active
                ? 'bg-black/[0.03] text-neutral-900 dark:bg-white/[0.06] dark:text-white'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]'
                }`}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.25 : 1.75}
                className={`relative z-10 shrink-0 ${active ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-500 dark:text-neutral-400'
                  }`}
              />
              <span className="relative z-10 flex items-center gap-2">
                {item.label}
                {'badge' in item && item.badge ? (
                  <span className="rounded-full border border-black/[0.08] bg-black/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-500">
                    {item.badge}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}

        {/* Recent Chats Section - Mobile */}
        {recentRuns.length > 0 && (
          <div className="mt-6 mb-3">
            <div className="mx-3 mb-3 h-px bg-black/[0.08] dark:bg-white/[0.08]" />
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400 dark:text-neutral-400">
              Research History
            </p>
            <div className="space-y-0.5">
              {recentRuns.map((run) => {
                const isCurrentRun =
                  pathname === `/runs/${run.run_id}` || continueRunId === run.run_id;
                return (
                  <div key={run.run_id} className="group relative flex items-center rounded-2xl transition-colors duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]">
                    <Link
                      href={`/?continue=${run.run_id}`}
                      onClick={onCloseMobile}
                      className={`flex-1 flex items-start gap-3 px-4 py-2.5 min-w-0 ${isCurrentRun
                        ? 'text-orange-700 dark:text-orange-300'
                        : 'text-neutral-700 dark:text-neutral-300'
                        }`}
                    >
                      <MessageSquare size={16} strokeWidth={1.75} className="shrink-0 opacity-60 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className={`block truncate text-sm leading-snug ${isCurrentRun ? 'font-semibold' : 'font-medium'}`}>
                          {run.query || 'Research run'}
                        </span>
                        {run.created_at && (
                          <span className="flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-600 mt-0.5">
                            <Clock size={9} />
                            {formatRunDate(run.created_at)}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex items-center gap-1 mr-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/?continue=${run.run_id}`); onCloseMobile(); }}
                        className="p-2 text-orange-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-lg transition-colors"
                        title="Continue chat"
                      >
                        <MessageSquare size={14} />
                      </button>
                      <Link
                        href={`/runs/${run.run_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg text-neutral-400 transition-colors hover:bg-black/[0.04] hover:text-neutral-700 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
                        title="View details"
                      >
                        <ExternalLink size={14} />
                      </Link>
                      <button
                        onClick={(e) => handleDeleteRun(e, run.run_id)}
                        disabled={isDeleting === run.run_id}
                        className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="space-y-1 px-3 pb-6 pt-3">
        <div className="mx-3 mb-2 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
        {/* Auth */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3">
            {isSignedIn && user ? (
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
                  {user.firstName?.charAt(0) || user.email?.charAt(0) || 'U'}
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-neutral-700 dark:text-neutral-300 truncate max-w-[140px]">
                    {user.firstName || user.email?.split('@')[0] || 'Account'}
                  </p>
                  {user.email && (
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate max-w-[140px]">
                      {user.email}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <Link
                href="/sign-in"
                className="flex items-center gap-3 text-[15px] font-semibold text-neutral-700 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
              >
                <LogIn size={20} strokeWidth={1.75} className="shrink-0" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
          {isSignedIn && (
            <form action={handleSignOut}>
              <button
                type="submit"
                className="text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                title="Log out"
              >
                <LogOut size={18} />
              </button>
            </form>
          )}
        </div>
        {/* Settings */}
        <Link
          href="/settings"
          onClick={onCloseMobile}
          className="mb-2 flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-[15px] font-semibold text-neutral-700 transition-all hover:bg-black/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
        >
          <Settings size={20} strokeWidth={1.75} className="shrink-0" />
          <span>{TEXT_CONFIG.sidebar.nav.settings}</span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside
        layout
        initial={false}
        animate={{ width: collapsed ? 64 : 260 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
        className="sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-black/[0.08] bg-white/55 font-poppins backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.06] dark:bg-[#0c0e14]/95 md:flex"
      >
        {desktopContent}
      </motion.aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
              onClick={onCloseMobile}
            />
            {/* Drawer */}
            <motion.aside
              key="mobile-sidebar"
              initial={{ x: '-100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0.5 }}
              transition={{ type: 'spring', bounce: 0.05, duration: 0.38 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col bg-white font-poppins shadow-2xl shadow-black/25 dark:bg-[#0c0e14] md:hidden border-r border-black/[0.06] dark:border-white/[0.05]"
            >
              {/* Close button */}
              <button
                onClick={onCloseMobile}
                className="absolute right-3 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100 hover:bg-black/[0.08] dark:hover:bg-white/[0.1] transition-all"
                aria-label={TEXT_CONFIG.sidebar.closeMenuAriaLabel}
              >
                <X size={18} strokeWidth={2} />
              </button>
              {mobileContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
