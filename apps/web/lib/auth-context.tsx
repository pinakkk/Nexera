'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * App-level auth user shape. Kept compatible with the previous WorkOS
 * `useAuth()` user (`firstName`, `email`) so consuming components only
 * needed an import swap, not a rewrite.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
});

function mapUser(u: SupabaseUser | null | undefined): AuthUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    '';
  const firstName =
    (meta.given_name as string | undefined) ??
    (fullName ? fullName.split(' ')[0] : null);
  return {
    id: u.id,
    email: u.email ?? null,
    firstName: firstName || null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(mapUser(data.user));
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapUser(session?.user));
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Drop-in replacement for the previous WorkOS `useAuth()` hook. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
