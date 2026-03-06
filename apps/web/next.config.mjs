import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Images from external sources
  images: {
    unoptimized: false,
  },
  // Monorepo root for output file tracing
  outputFileTracingRoot: resolve(__dirname, '../../'),
  // Vercel handles output automatically; standalone is only needed for Docker
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
};

export default nextConfig;
