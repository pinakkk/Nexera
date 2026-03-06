'use client';

import { SignUp } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';

export default function SignUpPage() {
    return (
        <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#fafafa] px-4 py-8 dark:bg-[#050505] font-poppins">
            {/* Animated Grid Background */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)]" />

            {/* Glowing Orbs */}
            <motion.div
                animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none absolute left-1/2 top-0 h-[300px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-orange-500/20 to-transparent blur-[100px] dark:from-orange-500/10 sm:h-[500px] sm:w-[800px]"
            />
            <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="pointer-events-none absolute left-0 bottom-0 h-[250px] w-[250px] -translate-x-1/2 translate-y-1/2 rounded-full bg-gradient-to-tr from-blue-500/20 to-transparent blur-[80px] dark:from-blue-500/10 sm:h-[400px] sm:w-[400px]"
            />
            <motion.div
                animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.3, 0.2] }}
                transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                className="pointer-events-none absolute right-0 top-[40%] h-[200px] w-[200px] translate-x-1/3 rounded-full bg-gradient-to-bl from-purple-500/20 to-transparent blur-[80px] dark:from-purple-500/10 sm:h-[300px] sm:w-[300px]"
            />

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="relative z-10 w-full max-w-[420px]"
            >
                <div className="mb-6 flex flex-col items-center text-center sm:mb-10">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.2, type: "spring" }}
                    >
                        <Link href="/" className="group flex items-center justify-center gap-2 mb-4 sm:mb-6">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-[0_0_40px_-10px_rgba(249,115,22,0.3)] ring-1 ring-black/[0.04] transition-transform duration-300 group-hover:scale-105 dark:bg-[#0d0f15] dark:shadow-[0_0_40px_-10px_rgba(249,115,22,0.2)] dark:ring-white/[0.05] sm:h-16 sm:w-16">
                                <Image
                                    src="/assets/square.png"
                                    alt="Nexara Logo"
                                    width={40}
                                    height={40}
                                    className="dark:hidden drop-shadow-xl h-8 w-8 sm:h-10 sm:w-10"
                                />
                                <Image
                                    src="/assets/darksquare.png"
                                    alt="Nexara Logo"
                                    width={40}
                                    height={40}
                                    className="hidden dark:block drop-shadow-xl h-8 w-8 sm:h-10 sm:w-10"
                                />
                            </div>
                        </Link>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                    >
                        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-white mb-2 bg-clip-text sm:text-3xl sm:mb-3">
                            Create your account
                        </h1>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto sm:text-base">
                            Join Nexara to unlock autonomous deep research, save your history, and sync across devices.
                        </p>
                    </motion.div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                >
                    <SignUp
                        appearance={{
                            elements: {
                                rootBox: 'mx-auto w-full',
                                card: 'rounded-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.1)] border border-black/[0.04] dark:border-white/[0.05] bg-white/70 dark:bg-[#0d0f15]/80 backdrop-blur-2xl p-2 sm:rounded-3xl sm:p-4',
                                headerTitle: 'hidden',
                                headerSubtitle: 'hidden',
                                socialButtonsBlockButton: 'rounded-xl h-11 sm:h-12 border border-black/[0.05] dark:border-white/[0.05] bg-white dark:bg-[#13151c] hover:bg-neutral-50 dark:hover:bg-[#1a1d24] text-neutral-600 dark:text-neutral-300 transition-all font-medium text-sm',
                                socialButtonsBlockButtonText: 'font-semibold',
                                dividerText: 'text-neutral-400 dark:text-neutral-500',
                                formFieldLabel: 'text-neutral-700 dark:text-neutral-300 font-medium text-sm',
                                formFieldInput: 'rounded-xl h-11 border-black/[0.05] dark:border-white/[0.05] bg-white dark:bg-[#13151c] text-neutral-900 dark:text-white focus:ring-2 focus:ring-orange-500/50 text-sm',
                                formButtonPrimary: 'rounded-xl h-11 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/25 transition-all font-semibold text-sm',
                                footerActionLink: 'text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 font-semibold transition-colors',
                                footerActionText: 'text-neutral-500 dark:text-neutral-400',
                                identityPreviewText: 'text-neutral-700 dark:text-neutral-300',
                                formFieldSuccessText: 'text-green-600 dark:text-green-400',
                                formFieldErrorText: 'text-red-600 dark:text-red-400',
                                alert: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-xl',
                            },
                        }}
                    />
                </motion.div>
            </motion.div>
        </div>
    );
}
