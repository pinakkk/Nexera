'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

/* ── Google SVG ─────────────────────────────────────────────────── */

function GoogleIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    );
}

/* ── Main page ──────────────────────────────────────────────────── */

export default function SignInPage() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-[#0d0d0d]">
                <Loader2 size={24} className="animate-spin text-neutral-400" />
            </div>
        }>
            <SignInContent />
        </Suspense>
    );
}

function SignInContent() {
    const [isNavigating, setIsNavigating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const searchParams = useSearchParams();

    // Show error if redirected back with error param
    useEffect(() => {
        const errorParam = searchParams.get('error');
        if (errorParam) {
            if (errorParam === 'auth_failed') {
                setError('Authentication failed. Please try again.');
            } else {
                setError(errorParam);
            }
        }
    }, [searchParams]);

    /**
     * Kicks off the Supabase Google OAuth flow. /api/auth/login generates
     * the provider URL and redirects the browser to Google's consent screen.
     */
    const signInWithGoogle = () => {
        setIsNavigating(true);
        setError(null);
        window.location.href = '/api/auth/login';
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 dark:bg-[#0d0d0d]">
            {/* Background gradient blobs */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
                <div className="absolute -top-1/4 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/[0.06] to-amber-500/[0.03] blur-[120px]" />
                <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-blue-500/[0.04] to-sky-500/[0.02] blur-[100px]" />
            </div>

            {/* Logo — uses the actual brand images from /public/assets/ */}
            <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="relative mb-8"
            >
                {/* Light mode logo */}
                <span className="block dark:hidden">
                    <Image
                        src="/assets/horizontal.png"
                        alt="Nexara"
                        width={180}
                        height={40}
                        className="h-auto w-[160px] object-contain sm:w-[180px]"
                        priority
                    />
                </span>
                {/* Dark mode logo */}
                <span className="hidden dark:block">
                    <Image
                        src="/assets/darkhorizontal.png"
                        alt="Nexara"
                        width={180}
                        height={40}
                        className="h-auto w-[160px] object-contain sm:w-[180px]"
                        priority
                    />
                </span>
            </motion.div>

            {/* Card */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                className="relative z-10 w-full max-w-[388px] rounded-2xl border border-neutral-200 bg-white p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12)] dark:border-neutral-800 dark:bg-[#1a1a1a] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)]"
            >
                {/* Heading */}
                <div className="mb-6 text-center">
                    <h1 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900 dark:text-white">
                        Log in or sign up
                    </h1>
                    <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                        Save your research and access all features.
                    </p>
                </div>

                {/* Error message */}
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/[0.08] dark:text-red-300"
                    >
                        <AlertCircle size={14} className="shrink-0 text-red-500" />
                        <span>{error}</span>
                    </motion.div>
                )}

                {/* Continue with Google — Supabase OAuth */}
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col gap-4"
                >
                    <button
                        id="sign-in-btn"
                        type="button"
                        onClick={signInWithGoogle}
                        disabled={isNavigating}
                        className="group flex h-12 w-full items-center justify-center gap-3 rounded-full border border-neutral-200 bg-white text-sm font-semibold text-neutral-900 transition-all duration-200 hover:bg-neutral-50 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                    >
                        {isNavigating ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <>
                                <span className="flex h-5 w-5 items-center justify-center">
                                    <GoogleIcon />
                                </span>
                                Continue with Google
                            </>
                        )}
                    </button>

                    <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
                        You&apos;ll be redirected to Google to sign in or create an account.
                    </p>
                </motion.div>
            </motion.div>

            {/* Footer */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="mt-5 text-center text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600"
            >
                By continuing, you agree to our{' '}
                <Link href="#" className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors">
                    Terms
                </Link>{' '}
                and{' '}
                <Link href="#" className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors">
                    Privacy Policy
                </Link>
                .
            </motion.p>

            {/* Back to app */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
                className="relative z-10 mt-6"
            >
                <Link
                    href="/"
                    className="text-xs text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                    ← Continue without signing in
                </Link>
            </motion.div>
        </div>
    );
}
