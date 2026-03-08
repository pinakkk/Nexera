import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export const GET = async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const loginHint = searchParams.get('login_hint') ?? undefined;

    const signInUrl = await getSignInUrl({ loginHint });
    return redirect(signInUrl);
};
