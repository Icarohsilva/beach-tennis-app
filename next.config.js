// next.config.js
const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14.2: instrumentation.ts só roda com este flag (padrão só no Next 15).
  experimental: {
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Só loga o upload de source maps em CI; sem SENTRY_AUTH_TOKEN o upload é pulado
  // (a captura de erro funciona mesmo sem source maps).
  silent: !process.env.CI,
})
