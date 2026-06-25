// scripts/generate-icons.mjs
// Gera os ícones do app (favicon, PWA 192/512, Apple touch) e a OG image a partir
// das artes de marca em public/brand/. Rode com: node scripts/generate-icons.mjs
//
// - arenahub-symbol.png  → ícone (só o símbolo da arena)
// - arenahub-logo.png    → OG image (símbolo + wordmark)
//
// O símbolo vem com fundo preto; achatamos sobre o navy da marca (#0c1220) para
// casar com bg-surface e garantir um quadrado cheio (bom para ícones maskable).
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_NAVY = '#0c1220'

const symbol = join(root, 'public/brand/arenahub-symbol.png')
const logo = join(root, 'public/brand/arenahub-logo.png')

// Gera um ícone quadrado: símbolo com folga, achatado sobre o navy da marca.
async function icon(size, out, { padRatio = 0.12 } = {}) {
  const pad = Math.round(size * padRatio)
  const inner = size - pad * 2
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

// Extrai o símbolo do fundo preto: a arte é um brilho laranja sobre preto puro,
// então a luminância vira o canal alfa (preto → transparente, brilho → opaco).
// Resultado: símbolo com fundo transparente para uso inline na UI.
async function transparentSymbol(out) {
  // RGB original (3 canais) + luminância (1 canal) interpolados manualmente em
  // RGBA: a luminância vira o alfa (preto → 0/transparente, brilho → 255/opaco).
  const { data: rgb, info } = await sharp(symbol)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { data: lum } = await sharp(symbol)
    .removeAlpha()
    .greyscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = lum[i]
  }
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(out)
  console.log('✓', out)
}

// OG image 1200×630: logo com wordmark centralizada sobre o navy.
async function og(out) {
  const W = 1200
  const H = 630
  const art = await sharp(logo)
    .resize(540, 540, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  await sharp({ create: { width: W, height: H, channels: 4, background: BRAND_NAVY } })
    .composite([{ input: art, gravity: 'center' }])
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
