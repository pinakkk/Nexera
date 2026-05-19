'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out and redirects to the home page (anonymous chat).
 * We redirect to '/' so the user lands in anonymous mode instead of
 * the sign-in page.
 */
export async function handleSignOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/');
}
