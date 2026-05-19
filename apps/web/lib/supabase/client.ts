import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client. Reads/writes the auth session from cookies
 * so it stays in sync with the server (middleware + route handlers).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
