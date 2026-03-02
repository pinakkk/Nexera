'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FlaskConical,
  FolderOpen,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { ThemeToggle } from './theme';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

const navItems = [
  { label: 'New Chat', href: '/', icon: Plus },
  { label: 'History', href: '/history', icon: Clock },
  { label: 'Projects', href: '/projects', icon: FolderOpen },
  { label: 'Settings', href: '/settings', icon: Settings },
];

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobile?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 pb-5 pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black">
          <FlaskConical size={16} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="h-display truncate text-sm font-semibold text-neutral-900 dark:text-white">
              Research Agent
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Autonomous Research
            </p>
          </div>
        )}
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/90 text-neutral-600 md:hidden dark:border-white/10 dark:bg-[#131b27] dark:text-neutral-200"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-sm text-neutral-500 dark:border-white/10 dark:bg-[#121a26] dark:text-neutral-300">
            Search ⌘K
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                active
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-neutral-700 hover:bg-black/[0.05] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-[#172132] dark:hover:text-white'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-black/10 px-3 pb-3 pt-3 dark:border-white/10">
        <ThemeToggle compact={collapsed} />
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-sm text-neutral-700 transition hover:bg-black/[0.04] md:flex dark:border-white/10 dark:bg-[#121a26] dark:text-neutral-200 dark:hover:bg-[#182235]"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      <aside
        className={`hidden h-screen shrink-0 border-r border-black/[0.06] bg-[#f6f7fa]/92 backdrop-blur-xl backdrop-saturate-150 md:block dark:border-white/[0.06] dark:bg-[#0c1017]/92 ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        } transition-[width] duration-300 ease-out`}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      </aside>

      <div
        className={`fixed inset-0 z-40 md:hidden ${
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={onCloseMobile}
          className={`absolute inset-0 bg-slate-950/15 backdrop-blur-[1px] transition-opacity duration-300 dark:bg-black/55 dark:backdrop-blur-sm ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Close sidebar overlay"
        />
        <aside
          className={`relative h-full w-[86vw] max-w-[320px] border-r border-black/10 bg-white/95 px-0 shadow-2xl shadow-slate-900/12 backdrop-blur-xl backdrop-saturate-150 transition-transform duration-300 ease-out dark:border-white/[0.08] dark:bg-[#0b1118]/96 dark:shadow-black/55 dark:backdrop-blur-2xl dark:backdrop-saturate-125 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarContent
            collapsed={false}
            onToggleCollapse={onToggleCollapse}
            onCloseMobile={onCloseMobile}
          />
        </aside>
      </div>
    </>
  );
}
