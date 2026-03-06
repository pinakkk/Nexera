import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api(.*)',
]);

const withClerk = clerkMiddleware(async (auth, request) => {
    // Don't protect public routes
    if (isPublicRoute(request)) {
        return;
    }
    // Protect all other routes — redirect to sign-in if not authenticated
    await auth.protect();
});

export default withClerk;

export const config = {
    matcher: [
        // Skip Next.js internals and static files
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
