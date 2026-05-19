import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /sign-up
 * Redirect to the sign-in page (Google OAuth handles both sign-in and sign-up).
 */
export async function GET(request: NextRequest) {
    const baseUrl = new URL('/', request.url);
    return NextResponse.redirect(new URL('/sign-in', baseUrl), 302);
}
