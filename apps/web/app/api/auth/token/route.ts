import { withAuth } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

export const GET = async () => {
    const { accessToken } = await withAuth();
    return NextResponse.json({ accessToken });
};
