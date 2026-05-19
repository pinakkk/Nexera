'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '@/components/theme';
import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth-context';
import { setAuthTokenGetter } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

/** Wires the Supabase access token into the API client. */
function AuthTokenSync() {
  useEffect(() => {
    const supabase = createClient();
    setAuthTokenGetter(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    });
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthTokenSync />
      <ThemeProvider>
        <AppShell>{children}</AppShell>
      </ThemeProvider>
    </AuthProvider>
  );
}
