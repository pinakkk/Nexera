'use client';

import { useEffect } from 'react';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';
import { ThemeProvider } from '@/components/theme';
import { AppShell } from '@/components/AppShell';
import { setAuthTokenGetter } from '@/lib/api';

/** Wires up the WorkOS AuthKit token so the API client can send it. */
function AuthTokenSync() {
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const res = await fetch('/api/auth/token');
        if (res.ok) {
          const data = await res.json();
          return data.accessToken || null;
        }
      } catch {
        // no-op
      }
      return null;
    });
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthKitProvider>
      <AuthTokenSync />
      <ThemeProvider>
        <AppShell>{children}</AppShell>
      </ThemeProvider>
    </AuthKitProvider>
  );
}
