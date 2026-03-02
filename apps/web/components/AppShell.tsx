'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

const SIDEBAR_STORAGE_KEY = 'research-agent-sidebar-collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      setCollapsed(raw === '1');
    } catch {
      setCollapsed(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Ignore localStorage failures.
    }
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="relative flex min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-white/92 text-neutral-700 shadow-lg shadow-slate-900/10 backdrop-blur-xl backdrop-saturate-150 transition-all hover:scale-105 hover:bg-white active:scale-95 md:hidden dark:border-white/15 dark:bg-[#121a26]/92 dark:text-neutral-100 dark:shadow-black/45 dark:hover:bg-[#172132]"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
