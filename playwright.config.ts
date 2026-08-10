// playwright.config.ts
// Só responsividade. `@playwright/test` já estava nas devDependencies, mas o repo
// nunca teve config nem suíte: o viewport mais estreito exercitado em qualquer
// script daqui era 390px (docs/faq/capture.mjs), então 375px — o iPhone 11 que a
// academia usa — e 320px nunca tinham sido renderizados uma vez.
//
// O Chromium vem pré-instalado na imagem (PLAYWRIGHT_BROWSERS_PATH); não rodar
// `playwright install`.
import fs from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PW_PORT ?? 3100)
const BASE_URL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PORT}`

/**
 * Chromium pré-instalado, quando existir.
 *
 * A imagem traz um build do Chromium sob PLAYWRIGHT_BROWSERS_PATH, mas o número do
 * build é atrelado à versão do Playwright: se o @playwright/test do projeto sobe, ele
 * passa a procurar um build que não está lá e manda rodar `playwright install` — que
 * neste ambiente não é o caminho. Apontar direto para o binário existente desacopla
 * os dois. Onde não houver, cai no resolvedor normal do Playwright (dev local, CI
 * com browsers próprios).
 */
function chromiumLocal(): string | undefined {
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!raiz || !fs.existsSync(raiz)) return undefined

  const candidatos = fs
    .readdirSync(raiz)
    .filter((d) => d.startsWith('chromium-'))
    // Build mais novo primeiro (chromium-1194 → 1194).
    .sort((a, b) => Number(b.split('-')[1] ?? 0) - Number(a.split('-')[1] ?? 0))
    .map((d) => `${raiz}/${d}/chrome-linux/chrome`)

  return candidatos.find((p) => fs.existsSync(p))
}

const executablePath = chromiumLocal()

export default defineConfig({
  testDir: './tests',
  // Layout é determinístico; um retry só esconderia flake de verdade.
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  outputDir: './tests/.artifacts',
  use: {
    baseURL: BASE_URL,
    // Screenshot de todo teste, não só dos que falham: em responsividade o
    // artefato é o entregável — é olhando o 320px que se confere o resultado.
    screenshot: 'on',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // `next dev` e não `next build && next start`: a bancada é dev-only (barrada em
  // produção), e o build completo exigiria as variáveis do Supabase.
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
