import { NextRequest, NextResponse } from 'next/server';
import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * GET /callback
 *
 * Default WorkOS AuthKit callback route.
 * WorkOS redirects here after the user authenticates.
 */
export const GET = handleAuth({
    returnPathname: '/',
    onError: async ({ error, request }) => {
        console.error('[callback] Authentication error:', {
            error: error instanceof Error ? error.message : String(error),
            url: request.url,
            code: request.nextUrl.searchParams.get('code') ? 'present' : 'missing',
            errorParam: request.nextUrl.searchParams.get('error'),
            errorDescription: request.nextUrl.searchParams.get('error_description'),
        });

        const workosError = request.nextUrl.searchParams.get('error');
        const workosDesc = request.nextUrl.searchParams.get('error_description');

        let errorMessage = 'auth_failed';
        if (workosError) {
            errorMessage = `${workosError}: ${workosDesc || 'Unknown error'}`;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        }

        const signInUrl = new URL('/sign-in', request.url);
        signInUrl.searchParams.set('error', errorMessage);
        return NextResponse.redirect(signInUrl);
    },
});
