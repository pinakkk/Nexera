import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/auth/login
 *
 * Starts the Supabase Google OAuth flow and redirects the user to
 * Google's consent screen. Supabase redirects back to
 * /api/auth/callback?code=... afterwards.
 *
 * Google OAuth must be enabled in the Supabase dashboard
 * (Authentication → Providers → Google).
 */
export async function GET(request: NextRequest) {
    const origin = new URL(request.url).origin;
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${origin}/api/auth/callback`,
        },
    });

    if (error || !data?.url) {
        console.error('[api/auth/login] OAuth init failed:', error?.message);
        const signInUrl = new URL('/sign-in', request.url);
        signInUrl.searchParams.set(
            'error',
            error?.message || 'Failed to initialize sign-in',
        );
        return NextResponse.redirect(signInUrl);
    }

    return NextResponse.redirect(data.url);
}
