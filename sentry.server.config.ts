import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Habilita o envio só quando há DSN configurado (dev local sem DSN = no-op).
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 100% em dev, 10% em prod — erros são sempre capturados; isto é só tracing.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
})
