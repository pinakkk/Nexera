'use client';

import { useEffect } from 'react';
import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ThemeProvider } from '@/components/theme';
import { AppShell } from '@/components/AppShell';
import { setAuthTokenGetter } from '@/lib/api';

/** Wires up the Clerk auth token so the API client can send it. */
function AuthTokenSync() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <AuthTokenSync />
      <ThemeProvider>
        <AppShell>{children}</AppShell>
      </ThemeProvider>
    </ClerkProvider>
  );
}
