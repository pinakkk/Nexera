import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/auth/callback
 *
 * Supabase redirects here after Google authentication with a `code`
 * query param. We exchange it for a session; the Supabase server client
 * sets the auth cookies. Then we redirect to the post-login destination.
 */
export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error_description') || searchParams.get('error');

    if (errorParam) {
        const signInUrl = new URL('/sign-in', origin);
        signInUrl.searchParams.set('error', errorParam);
        return NextResponse.redirect(signInUrl);
    }

    if (!code) {
        const signInUrl = new URL('/sign-in', origin);
        signInUrl.searchParams.set('error', 'auth_failed');
        return NextResponse.redirect(signInUrl);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
        console.error('[auth/callback] Code exchange failed:', error.message);
        const signInUrl = new URL('/sign-in', origin);
        signInUrl.searchParams.set('error', error.message);
        return NextResponse.redirect(signInUrl);
    }

    return NextResponse.redirect(new URL('/', origin));
}
