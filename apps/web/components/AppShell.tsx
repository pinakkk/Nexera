'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { TEXT_CONFIG } from '@/lib/text-config';

const SIDEBAR_STORAGE_KEY = 'research-agent-sidebar-collapsed';

/* ── Animated hamburger icon ───────────────────────────────────── */
function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <div className="flex h-5 w-5 flex-col items-center justify-center gap-[5px]">
      <motion.span
        animate={open ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="block h-[1.5px] w-5 rounded-full bg-current"
      />
      <motion.span
        animate={open ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.18, ease: 'easeInOut' }}
        className="block h-[1.5px] w-5 rounded-full bg-current"
      />
      <motion.span
        animate={open ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="block h-[1.5px] w-5 rounded-full bg-current"
      />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth pages render without sidebar/hamburger
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

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

  if (isAuthPage) {
    return <>{children}</>;
  }

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
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="fixed left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/90 text-neutral-700 shadow-lg shadow-black/[0.06] backdrop-blur-xl transition-all hover:scale-105 hover:bg-white active:scale-95 md:hidden dark:border-white/[0.08] dark:bg-[#0e1016]/90 dark:text-neutral-100 dark:shadow-black/30 dark:hover:bg-[#131821]"
          aria-label={TEXT_CONFIG.appShell.openMenuAriaLabel}
          aria-expanded={mobileOpen}
        >
          <HamburgerIcon open={mobileOpen} />
        </button>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="min-h-full animate-fade-in-fast">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
