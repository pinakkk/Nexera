'use client';

import { SignIn } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

export default function SignInPage() {
    return (
        <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#f7f5f2] px-4 py-10 font-poppins dark:bg-[#07090d]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#8d868012_1px,transparent_1px),linear-gradient(to_bottom,#8d868012_1px,transparent_1px)] bg-[size:26px_26px]" />
            <motion.div
                animate={{ x: [0, 22, -14, 0], y: [0, -10, 14, 0], opacity: [0.24, 0.34, 0.22, 0.24] }}
                transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute -top-20 left-[22%] h-[280px] w-[280px] rounded-full bg-[#f59e0b]/30 blur-[86px] dark:bg-[#f59e0b]/18"
            />
            <motion.div
                animate={{ x: [0, -20, 16, 0], y: [0, 12, -10, 0], opacity: [0.2, 0.28, 0.18, 0.2] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute bottom-[-60px] right-[10%] h-[260px] w-[260px] rounded-full bg-sky-400/30 blur-[92px] dark:bg-sky-400/14"
            />

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-[460px]"
            >
                <Link
                    href="/"
                    className="mb-5 inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2 text-xs font-semibold text-neutral-600 backdrop-blur-lg transition-colors hover:text-orange-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:text-orange-400"
                >
                    <ArrowLeft size={14} />
                    Back to chat
                </Link>

                <div className="mb-7 flex flex-col items-center text-center sm:mb-8">
                    <Link href="/" className="group mb-4 flex items-center justify-center sm:mb-5">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/80 shadow-[0_12px_45px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-transform duration-300 group-hover:scale-[1.03] dark:border-white/[0.08] dark:bg-[#10131a]/75">
                            <Image
                                src="/assets/square.png"
                                alt="Nexara Logo"
                                width={40}
                                height={40}
                                className="h-9 w-9 object-contain dark:hidden"
                                priority
                            />
                            <Image
                                src="/assets/darksquare.png"
                                alt="Nexara Logo"
                                width={40}
                                height={40}
                                className="hidden h-9 w-9 object-contain dark:block"
                                priority
                            />
                        </div>
                    </Link>
                    <h1 className="text-[30px] font-extrabold tracking-tight text-neutral-900 dark:text-white">
                        Sign in to Nexara
                    </h1>
                    <p className="mt-2 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
                        Continue your research history and sync progress across devices.
                    </p>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.12 }}
                >
                    <SignIn
                        appearance={{
                            elements: {
                                rootBox: 'mx-auto w-full',
                                card: 'rounded-[24px] border border-black/[0.06] bg-white/80 p-3 shadow-[0_14px_55px_-24px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#11151c]/82 sm:p-5',
                                header: 'hidden',
                                headerTitle: 'hidden',
                                headerSubtitle: 'hidden',
                                socialButtonsBlockButton: 'mt-1 h-11 rounded-xl border border-black/[0.08] bg-[#ffffff] text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/[0.08] dark:bg-[#171b24] dark:text-neutral-200 dark:hover:bg-[#202531]',
                                socialButtonsBlockButtonText: 'font-semibold',
                                socialButtonsBlock: 'space-y-2.5',
                                dividerRow: 'my-4',
                                dividerText: 'px-2 text-[11px] uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500',
                                formFieldRow: 'mb-3.5',
                                formFieldLabel: 'mb-1.5 text-[12px] font-semibold text-neutral-600 dark:text-neutral-300',
                                formFieldInput: 'h-11 rounded-xl border-black/[0.1] bg-white px-3 text-sm text-neutral-900 focus:ring-2 focus:ring-orange-500/30 dark:border-white/[0.1] dark:bg-[#171b24] dark:text-white',
                                formButtonPrimary: 'mt-2 h-11 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-sm font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-orange-700',
                                footerActionLink: 'text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300',
                                footerActionText: 'text-sm text-neutral-500 dark:text-neutral-400',
                                formFieldSuccessText: 'text-xs text-emerald-600 dark:text-emerald-400',
                                formFieldErrorText: 'text-xs text-red-600 dark:text-red-400',
                                alert: 'rounded-lg border border-red-400/25 bg-red-500/10 text-red-600 dark:text-red-400',
                                clerkBadge: 'hidden',
                                footer: 'pt-2',
                            },
                        }}
                    />
                </motion.div>
            </motion.div>
        </div>
    );
}
