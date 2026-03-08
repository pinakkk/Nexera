import { NextRequest, NextResponse } from 'next/server';
import { getSignInUrl, getSignUpUrl } from '@workos-inc/authkit-nextjs';

/**
 * GET /api/auth/login
 *
 * Generates a WorkOS sign-in URL and redirects the user to the
 * AuthKit hosted login UI. If a specific OAuth provider is requested,
 * it's appended as a hint — but WorkOS will only use it if that
 * provider is configured in the dashboard.
 *
 * Query params:
 *   - provider: 'GoogleOAuth' | 'AppleOAuth' (optional)
 *   - login_hint: email address for pre-filling (optional)
 *   - signup: 'true' to redirect to sign-up instead (optional)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    const loginHint = searchParams.get('login_hint');
    const isSignUp = searchParams.get('signup') === 'true';

    try {
        const options: {
            loginHint?: string;
            returnTo?: string;
        } = {
            returnTo: '/',
        };

        if (loginHint) {
            options.loginHint = loginHint;
        }

        // Get the WorkOS authorization URL via AuthKit
        // This uses provider=authkit by default, which shows the hosted login UI
        let authorizationUrl: string;

        if (isSignUp) {
            authorizationUrl = await getSignUpUrl(options);
        } else {
            authorizationUrl = await getSignInUrl(options);
        }

        // If a specific OAuth provider was requested AND it's configured
        // in WorkOS, this will auto-redirect. If not configured, the user
        // will see the hosted AuthKit UI with available methods.
        if (provider) {
            const url = new URL(authorizationUrl);
            url.searchParams.set('provider', provider);
            authorizationUrl = url.toString();
        }

        console.log('[api/auth/login] Redirecting to:', authorizationUrl);
        return NextResponse.redirect(authorizationUrl);
    } catch (error) {
        console.error('[api/auth/login] Failed to get authorization URL:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to initialize sign-in';
        const signInUrl = new URL('/sign-in', request.url);
        signInUrl.searchParams.set('error', errorMessage);
        return NextResponse.redirect(signInUrl);
    }
}


