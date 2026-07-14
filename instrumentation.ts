import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// No Next 15 este hook captura erros de Server Components/middleware.
// No Next 14.2 ele não é chamado pelo framework (inócuo) — deixa o upgrade pronto.
export const onRequestError = Sentry.captureRequestError
