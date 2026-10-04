// next.config.js
const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14.2: instrumentation.ts só roda com este flag (padrão só no Next 15).
  experimental: {
    instrumentationHook: true,
    // OCR do print de check-in (lib/checkin/receiptReader.ts): o tesseract.js
    // sobe um worker_thread a partir de arquivos do próprio pacote, que o
    // webpack quebraria ao empacotar.
    serverComponentsExternalPackages: ['tesseract.js'],
    // O modelo de português do OCR é lido do node_modules em tempo de execução;
    // sem isto ele fica fora do deploy da Vercel. Só a rota onde o aluno envia
    // o check-in (a server action roda na função da /home) precisa dele.
    outputFileTracingIncludes: {
      '/home': ['./node_modules/@tesseract.js-data/por/4.0.0_best_int/**'],
    },
  },
  // Identidade da build, inlinada em tempo de build no bundle do cliente E no do
  // servidor. É o que permite detectar deploy novo: o navegador de quem está com o
  // app aberto há dias carrega o valor da build antiga, e /api/version — servida pelo
  // deploy novo — devolve o valor dele. Ver lib/version.ts.
  //
  // Só 12 caracteres do SHA: o valor aparece numa rota pública, e o commit inteiro
  // não precisa circular. Sem a env (dev, ou System Environment Variables desligadas
  // na Vercel) vira 'dev' e o mecanismo fica inerte, sem laço de reload.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || 'dev',
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
