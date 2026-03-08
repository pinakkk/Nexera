import { NextRequest, NextResponse } from 'next/server';
import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * GET /api/auth/callback
 *
 * WorkOS redirects here after the user authenticates. We delegate to
 * AuthKit's handleAuth() which:
 *   1. Exchanges the authorization code for session tokens.
 *   2. Sets a secure, httpOnly session cookie (wos-session).
 *   3. Redirects to the configured post-login destination (/).
 *
 * The cookie is configured by WORKOS_COOKIE_PASSWORD in .env.local.
 */
export const GET = handleAuth({
    returnPathname: '/',
    onError: async ({ error, request }) => {
        // Log the full error for debugging
        console.error('[auth/callback] Authentication error:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            url: request.url,
            code: request.nextUrl.searchParams.get('code') ? 'present' : 'missing',
            state: request.nextUrl.searchParams.get('state') ? 'present' : 'missing',
            errorParam: request.nextUrl.searchParams.get('error'),
            errorDescription: request.nextUrl.searchParams.get('error_description'),
        });

        // Check if WorkOS returned an error directly
        const workosError = request.nextUrl.searchParams.get('error');
        const workosDesc = request.nextUrl.searchParams.get('error_description');

        let errorMessage = 'auth_failed';
        if (workosError) {
            errorMessage = `${workosError}: ${workosDesc || 'Unknown error'}`;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        }

        // Redirect back to sign-in with the actual error
        const signInUrl = new URL('/sign-in', request.url);
        signInUrl.searchParams.set('error', errorMessage);
        return NextResponse.redirect(signInUrl);
    },
});

