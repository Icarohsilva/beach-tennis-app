// scripts/generate-icons.mjs
// Gera os ícones do app (favicon, PWA 192/512, Apple touch) e a OG image a partir
// da arte de marca em public/brand/arenahub-symbol.png. Rode com:
//   node scripts/generate-icons.mjs
//
// A arte-fonte (arenahub-symbol.png) já vem com transparência real (canto
// alpha=0) e o próprio quadrado arredondado laranja preenchido — diferente da
// versão anterior (glow sobre fundo preto puro, que exigia extrair a silhueta
// via luminância). Por isso aqui só resize + composição direta.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_NAVY = '#0c1220'
const BRAND_ORANGE = '#f97316'

const symbol = join(root, 'public/brand/arenahub-symbol.png')

// Gera um ícone quadrado: símbolo com folga (safe-zone para maskable icons),
// achatado sobre o navy da marca (#0c1220) para casar com bg-surface.
async function icon(size, out, { padRatio = 0.14 } = {}) {
  const inner = Math.round(size * (1 - padRatio * 2))
  const fg = await sharp(symbol)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_NAVY },
  })
    .composite([{ input: fg, gravity: 'center' }])
    .png()
    .toFile(out)
  console.log('✓', out)
}

// Símbolo transparente para uso inline na UI (sidebar, login, landing, etc.).
// A arte-fonte já tem fundo transparente nativo — só normalizamos via sharp.
async function transparentSymbol(out) {
  await sharp(symbol).png().toFile(out)
  console.log('✓', out)
}

// OG image 1200×630: símbolo + wordmark "ArenaHub" centralizados sobre o navy.
async function og(out) {
  const W = 1200
  const H = 630
  const iconSize = 320
  const fg = await sharp(symbol)
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()

  const svgText = `<svg width="${W}" height="120" xmlns="http://www.w3.org/2000/svg">
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="72">
      <tspan fill="#ffffff">Arena</tspan><tspan fill="${BRAND_ORANGE}">Hub</tspan>
    </text>
  </svg>`

  await sharp({ create: { width: W, height: H, channels: 4, background: BRAND_NAVY } })
    .composite([
      { input: fg, top: 90, left: Math.round((W - iconSize) / 2) },
      { input: Buffer.from(svgText), top: 420, left: 0 },
    ])
    .png()
    .toFile(out)
  console.log('✓', out)
}

async function main() {
  await mkdir(join(root, 'public/icons'), { recursive: true })

  // PWA (manifest)
  await icon(192, join(root, 'public/icons/icon-192x192.png'))
  await icon(512, join(root, 'public/icons/icon-512x512.png'))

  // App Router file-based icons (Next gera os <link> automaticamente)
  await icon(512, join(root, 'app/icon.png'))
  await icon(180, join(root, 'app/apple-icon.png'), { padRatio: 0.1 })

  // Favicon PNG pequeno (símbolo mais cheio para legibilidade em 48px)
  await icon(48, join(root, 'public/favicon-48.png'), { padRatio: 0.06 })

  // Símbolo transparente para uso inline na UI (sidebar, login, etc.)
  await transparentSymbol(join(root, 'public/brand/arenahub-symbol-transparent.png'))

  // OG / social
  await og(join(root, 'public/og.png'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
