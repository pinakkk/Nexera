'use server';

import { signOut } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

/**
 * Signs the user out and redirects to the home page (anonymous chat).
 * We redirect to '/' so the user lands in anonymous mode instead of
 * seeing the sign-in page or WorkOS error page.
 */
export async function handleSignOut() {
    try {
        await signOut({ returnTo: '/' });
    } catch {
        // If WorkOS sign-out fails (e.g., demo/staging credentials),
        // just redirect home — the cookie will be cleared on next visit
        redirect('/');
    }
}
