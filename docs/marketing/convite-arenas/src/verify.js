// QA dos QR codes.  npm run verify
//
// Duas perguntas, porque são dois riscos diferentes:
//
//  1. O módulo impresso é grande o suficiente? Abaixo de ~0,4 mm o ponto começa
//     a fechar no papel e o código morre na tiragem inteira. Isso é geometria,
//     não é opinião, dá para calcular antes de imprimir.
//  2. O código decodifica de fato? As peças são decodificadas a partir da imagem
//     gerada, reduzida ao tamanho em que uma câmera de celular enquadra a peça.
//     (Decodificar no raster nativo de 3471 px não vale como teste: o jsQR falha
//     em imagens gigantes por limite dele, não da arte.)
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const jsQR = require('jsqr')
const cfg = require('./config')
const { qrSvg } = require('./qr')
const { QR_IMPRESSO } = require('./art')

const OUT = path.join(__dirname, '..', 'out')
const QUIET = 4 // módulos de zona de silêncio de cada lado (mínimo da norma)
const MODULO_MIN_MM = 0.4

const modulosTotais = (url, ecc = 'H') => qrSvg(url, { ecc }).modulos + QUIET * 2

const PECAS = [
  {
    arquivo: 'qa/qa-qr-whatsapp.png',
    onde: 'QR do WhatsApp',
    esperado: `https://wa.me/${cfg.whatsappE164}?text=${encodeURIComponent(cfg.mensagemConvite(cfg.arenas[0]))}`,
    utilMm: QR_IMPRESSO.whatsapp.utilMm,
    ecc: 'Q',
    larguras: [120, 200, 320],
  },
  {
    arquivo: 'qa/qa-qr-instagram.png',
    onde: 'QR da contracapa',
    esperado: cfg.qrInstagram,
    utilMm: QR_IMPRESSO.contracapa.utilMm,
    // Larguras em px que a câmera resolve do código quando ele preenche o
    // enquadramento: de um celular ruim e longe (120px) a um bom e perto.
    larguras: [120, 200, 400],
  },
  {
    arquivo: 'qa/qa-qr-criar.png',
    onde: 'QR da parte interna',
    esperado: cfg.qrCriar,
    utilMm: QR_IMPRESSO.interna.utilMm,
    larguras: [120, 200, 297],
  },
  {
    arquivo: 'ArenaHub-Convite-WhatsApp-1080x1350.png',
    onde: 'WhatsApp 1080×1350',
    esperado: cfg.qrInstagram,
    larguras: [1080, 720],
  },
  {
    arquivo: 'ArenaHub-Convite-Story-1080x1920.png',
    onde: 'Story 1080×1920',
    esperado: cfg.qrInstagram,
    larguras: [1080, 720],
  },
]

function ler(arquivo) {
  const png = PNG.sync.read(fs.readFileSync(path.join(OUT, arquivo)))
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }
}

function reduzir(img, escala) {
  const w = Math.max(1, Math.round(img.width * escala))
  const h = Math.max(1, Math.round(img.height * escala))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.round(y / escala))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x / escala))
      const s = (sy * img.width + sx) * 4
      const d = (y * w + x) * 4
      out[d] = img.data[s]
      out[d + 1] = img.data[s + 1]
      out[d + 2] = img.data[s + 2]
      out[d + 3] = img.data[s + 3]
    }
  }
  return { data: out, width: w, height: h }
}

let falhas = 0
const falhou = (msg) => {
  falhas++
  console.log(`  FALHOU  ${msg}`)
}

for (const p of PECAS) {
  if (!fs.existsSync(path.join(OUT, p.arquivo))) {
    falhou(`${p.arquivo} não existe, rode npm run build`)
    continue
  }

  // 1. Tamanho do módulo impresso
  if (p.utilMm) {
    const mod = p.utilMm / modulosTotais(p.esperado, p.ecc)
    const ok = mod >= MODULO_MIN_MM
    if (!ok) falhas++
    console.log(
      `  ${ok ? 'ok' : 'FALHOU'}  ${p.onde} · QR ${p.utilMm.toFixed(1)} mm · módulo ${mod.toFixed(2)} mm (mínimo ${MODULO_MIN_MM} mm)`
    )
  }

  // 2. Decodificação em enquadramentos plausíveis de câmera
  const img = ler(p.arquivo)
  const larguras = p.larguras
  const lidos = []
  for (const alvo of larguras) {
    if (alvo > img.width) continue
    const im = alvo === img.width ? img : reduzir(img, alvo / img.width)
    const r = jsQR(im.data, im.width, im.height)
    lidos.push({ alvo, texto: r && r.data })
  }
  const todosOk = lidos.length > 0 && lidos.every((l) => l.texto === p.esperado)
  if (!todosOk) falhas++
  console.log(
    `  ${todosOk ? 'ok' : 'FALHOU'}  ${p.onde} · decodifica em ${lidos.map((l) => l.alvo + 'px').join(', ')} → ${
      lidos.find((l) => l.texto)?.texto ?? 'não decodificou'
    }`
  )
  for (const l of lidos) {
    if (l.texto !== p.esperado) console.log(`          ↳ ${l.alvo}px devolveu ${l.texto ?? 'nada'}`)
  }
}

console.log(falhas === 0 ? '\nTodos os QR codes passam.' : `\n${falhas} verificação(ões) falharam.`)
process.exit(falhas === 0 ? 0 : 1)
