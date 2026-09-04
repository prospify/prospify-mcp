/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type checking runs in CI via `bun tsc --noEmit`. Skip during
  // Next.js build to avoid conflicts with bun-types on Vercel's
  // Node runtime.
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
