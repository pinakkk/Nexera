import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/auth/token
 *
 * Returns the current Supabase access token. Used by the SSE client,
 * which can't set an Authorization header on EventSource and must pass
 * the token as a query param instead.
 */
export const GET = async () => {
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return NextResponse.json({ accessToken: session?.access_token ?? null });
};
