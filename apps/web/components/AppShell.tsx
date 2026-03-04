'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TEXT_CONFIG } from '@/lib/text-config';

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
        {/* Mobile menu button */}
        <motion.button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/90 text-neutral-700 shadow-lg shadow-black/[0.06] backdrop-blur-xl transition-all hover:scale-105 hover:bg-white active:scale-95 md:hidden dark:border-white/[0.08] dark:bg-[#0e1016]/90 dark:text-neutral-100 dark:shadow-black/30 dark:hover:bg-[#131821]"
          aria-label={TEXT_CONFIG.appShell.openMenuAriaLabel}
          whileTap={{ scale: 0.92 }}
        >
          <Menu size={18} strokeWidth={1.75} />
        </motion.button>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
