import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

/**
 * WorkOS AuthKit middleware.
 *
 * unauthenticatedPaths: routes that do NOT require authentication.
 * Everything else (e.g. /runs/*, /settings, /projects) is protected.
 *
 * NOTE: WorkOS AuthKit uses glob-style matching, NOT regex.
 * Patterns like `(.*)` or `(?!...)` will cause parse errors.
 */
export default authkitMiddleware({
    middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: [
            // Public pages
            '/',
            '/sign-in',
            '/sign-up',
            // Auth flow routes (must be public so the redirect loop is avoided)
            '/api/auth/login',
            '/api/auth/callback',
            '/callback',
            // API routes (they handle their own auth via API key headers)
            '/api/auth/token',
            '/api/db/:path*',
        ],
    },
});

export const config = {
    matcher: [
        // Match all paths except Next.js internals and static files
        '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|assets/.*).*)',
    ],
};
