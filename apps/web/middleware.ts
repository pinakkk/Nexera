import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase auth middleware.
 *
 * - Refreshes the Supabase session cookie on every request.
 * - Routes in UNAUTHENTICATED_PATHS are public (anonymous mode still works
 *   here — the home page lets users explore without signing in).
 * - Everything else (e.g. /runs/*, /settings, /projects) requires a
 *   signed-in user and redirects to /sign-in otherwise.
 */
const UNAUTHENTICATED_PATHS = [
  '/',
  '/sign-in',
  '/sign-up',
  '/api/auth/login',
  '/api/auth/callback',
  '/callback',
  '/api/auth/token',
];

function isPublicPath(pathname: string): boolean {
  if (UNAUTHENTICATED_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/api/db/')) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() (not getSession()) revalidates the token with
  // Supabase, so an expired/forged cookie can't pass the gate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|assets/.*).*)',
  ],
};
