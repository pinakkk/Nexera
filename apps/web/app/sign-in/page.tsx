'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Mail, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

/* ── Provider button ────────────────────────────────────────────── */

interface ProviderButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    delay?: number;
}

function ProviderButton({ icon, label, onClick, delay = 0 }: ProviderButtonProps) {
    return (
        <motion.button
            type="button"
            onClick={onClick}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay }}
            className="group flex w-full items-center justify-center gap-3 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-sm font-medium text-neutral-900 transition-all duration-200 hover:bg-white hover:border-neutral-300 hover:shadow-sm active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        >
            <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
            <span>{label}</span>
        </motion.button>
    );
}

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

/* ── Apple SVG ──────────────────────────────────────────────────── */

function AppleIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current text-neutral-900 dark:text-white">
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.54 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09z" />
            <path d="M15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
        </svg>
    );
}

/* ── Separator ──────────────────────────────────────────────────── */

function Separator() {
    return (
        <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">OR</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        </div>
    );
}

/* ── Nexara text logo (SVG — no external image dependency) ──────── */

function NexaraLogo({ dark }: { dark?: boolean }) {
    return (
        <svg
            viewBox="0 0 160 32"
            className="h-8 w-auto"
            aria-label="Nexara"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* Orange square icon */}
            <rect x="0" y="4" width="24" height="24" rx="6" fill="#f97316" />
            <path
                d="M7 21 L12 11 L17 21 M9.5 17 H14.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            {/* Wordmark */}
            <text
                x="32"
                y="23"
                fontFamily="system-ui, -apple-system, sans-serif"
                fontSize="18"
                fontWeight="700"
                letterSpacing="-0.5"
                fill={dark ? '#ffffff' : '#111827'}
            >
                Nexara
            </text>
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
    const [email, setEmail] = useState('');
    const [isNavigating, setIsNavigating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const searchParams = useSearchParams();

    // Show error if redirected back with error param
    useEffect(() => {
        const errorParam = searchParams.get('error');
        if (errorParam) {
            // Show the actual error message from WorkOS callback
            if (errorParam === 'auth_failed') {
                setError('Authentication failed. Please try again.');
            } else {
                setError(errorParam);
            }
        }
    }, [searchParams]);

    /**
     * All auth flows go through /api/auth/login which generates a WorkOS
     * authorization URL and redirects the user. The AuthKit hosted UI
     * handles showing the available login methods.
     *
     * Note: OAuth providers (Google, Apple) must be configured in the
     * WorkOS Dashboard → Authentication → Social Login. If they're not
     * configured, we redirect to AuthKit's hosted UI which shows the
     * available methods.
     */
    const navigateToLogin = (provider?: 'GoogleOAuth' | 'AppleOAuth') => {
        setIsNavigating(true);
        setError(null);
        const params = new URLSearchParams();
        if (provider) params.set('provider', provider);
        window.location.href = `/api/auth/login?${params.toString()}`;
    };

    /**
     * Redirect straight to AuthKit hosted login UI (shows all configured methods)
     */
    const navigateToAuthKit = () => {
        setIsNavigating(true);
        setError(null);
        window.location.href = '/api/auth/login';
    };

    const handleEmailContinue = () => {
        if (!email.trim()) return;
        setIsNavigating(true);
        setError(null);
        const params = new URLSearchParams({ login_hint: email.trim() });
        window.location.href = `/api/auth/login?${params.toString()}`;
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

                {/* Sign in — redirects to WorkOS AuthKit hosted UI */}
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col gap-4"
                >
                    <button
                        id="sign-in-btn"
                        type="button"
                        onClick={navigateToAuthKit}
                        disabled={isNavigating}
                        className="group flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-neutral-900 text-sm font-semibold text-white transition-all duration-200 hover:bg-neutral-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600"
                    >
                        {isNavigating ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <>
                                Sign in
                                <ArrowRight
                                    size={15}
                                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                                />
                            </>
                        )}
                    </button>

                    <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
                        You&apos;ll be redirected to sign in or create an account.
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
