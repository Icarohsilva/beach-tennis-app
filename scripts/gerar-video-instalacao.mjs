// scripts/gerar-video-instalacao.mjs
// -----------------------------------------------------------------------------
// Gera docs/faq/images/instalar-ios.gif a partir da página /instalar: navega
// uma vez por cena com ?cena=N, recorta a moldura do iPhone e monta um GIF
// animado. Não depende de ffmpeg — sharp faz a montagem via `join`.
//
// Uso:
//   1. Suba o app:  npm run dev        (localhost:3000)
//   2. Rode:        npm run gerar:video-instalacao
//
// Variáveis de ambiente:
//   INSTALL_BASE_URL -> base do app (default http://localhost:3000)
// -----------------------------------------------------------------------------
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { dirname, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.INSTALL_BASE_URL ?? 'http://localhost:3000'
const RAIZ = join(__dirname, '..')

// Dois destinos, de propósito. docs/faq/images/ é a fonte que os .md referenciam
// como `](images/...)`; public/faq/images/ é de onde o app serve o manual, já que
// app/ajuda/[manual]/page.tsx reescreve esse caminho para `/faq/images/...`.
// Gravar só no primeiro faz a imagem quebrar dentro do app, sem aviso nenhum.
const DESTINOS = [
  join(RAIZ, 'docs', 'faq', 'images', 'instalar-ios.gif'),
  join(RAIZ, 'public', 'faq', 'images', 'instalar-ios.gif'),
]

// Precisa bater com SCENE_COUNT/SCENE_MS de lib/pwa/passosInstalacao.ts.
const CENAS = 6
const DELAY_MS = 2200

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 420, height: 760 },
  deviceScaleFactor: 2,
})

const frames = []
for (let cena = 0; cena < CENAS; cena++) {
  await page.goto(`${BASE_URL}/instalar?cena=${cena}`, { waitUntil: 'networkidle' })
  const moldura = page.locator('[data-install-stage]')
  await moldura.waitFor({ state: 'visible' })
  // As transições CSS duram 500ms; espere assentar antes de fotografar.
  await page.waitForTimeout(800)
  frames.push(await moldura.screenshot({ type: 'png' }))
  console.log(`  cena ${cena + 1}/${CENAS} capturada`)
}

await browser.close()

const gif = await sharp(frames, { join: { across: 1, animated: true } })
  .gif({ loop: 0, delay: frames.map(() => DELAY_MS) })
  .toBuffer()

console.log(`\nGIF gerado com ${frames.length} quadros de ${DELAY_MS}ms:`)
for (const destino of DESTINOS) {
  await writeFile(destino, gif)
  console.log(`  ${destino}`)
}
