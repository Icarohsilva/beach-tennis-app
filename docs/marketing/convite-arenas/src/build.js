// Gera tudo: PDFs fechados para a gráfica, PNGs para WhatsApp e previews.
//
//   npm install && npm run build
//
// O Chromium do Playwright é usado como RIP: o PDF sai vetorial, com as fontes
// embutidas, no tamanho exato em milímetros declarado no @page.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { chromium } = require('playwright')
const cfg = require('./config')
const { qrSvg } = require('./qr')
const { documentoPrint, pecaDigital, selo, fichaProducao, QR_IMPRESSO } = require('./art')

const SRC = __dirname
const OUT = path.join(SRC, '..', 'out')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arenahub-convite-'))

// Chromium já vem instalado no ambiente; PLAYWRIGHT_CHROMIUM permite apontar
// para outro binário sem mexer no código.
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || undefined

function escrever(nome, html) {
  // O HTML vai para um temporário DENTRO de src/ para que as fontes com caminho
  // relativo (./assets/fonts/…) continuem resolvendo.
  const p = path.join(SRC, `.tmp-${nome}.html`)
  fs.writeFileSync(p, html)
  return 'file://' + p
}

function limpar() {
  for (const f of fs.readdirSync(SRC)) {
    if (f.startsWith('.tmp-')) fs.unlinkSync(path.join(SRC, f))
  }
  fs.rmSync(TMP, { recursive: true, force: true })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })

  const ig = qrSvg(cfg.qrInstagram, { logo: true })
  const criar = qrSvg(cfg.qrCriar, { logo: true })
  const qrWhatsappDe = (arena) =>
    qrSvg(`https://wa.me/${cfg.whatsappE164}?text=${encodeURIComponent(cfg.mensagemConvite(arena))}`, {
      logo: false,
      ecc: 'Q', // a URL com a mensagem é longa; H estouraria o módulo mínimo em 30 mm
    }).svg
  console.log(`QR Instagram  v${ig.versao} · ${ig.modulos}×${ig.modulos} módulos · ECC H`)
  console.log(`QR Criar      v${criar.versao} · ${criar.modulos}×${criar.modulos} módulos · ECC H`)
  fs.writeFileSync(path.join(SRC, 'assets/qr-instagram.svg'), ig.svg)
  fs.writeFileSync(path.join(SRC, 'assets/qr-criar-academia.svg'), criar.svg)

  const navegador = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--font-render-hinting=none', '--force-color-profile=srgb'],
  })

  const gerados = []
  const registrar = (arquivo) => {
    const kb = Math.round(fs.statSync(path.join(OUT, arquivo)).size / 1024)
    gerados.push(`${arquivo} (${kb} KB)`)
  }

  // ---------------------------------------------------------------- impressos
  for (const [comMarcas, nome] of [
    [true, 'ArenaHub-Convite-COM-MARCAS.pdf'],
    [false, 'ArenaHub-Convite-SANGRIA-3mm.pdf'],
  ]) {
    const html = documentoPrint({ cfg, qrInstagram: ig.svg, qrCriar: criar.svg, qrWhatsappDe, comMarcas })
    const p = await navegador.newPage()
    await p.goto(escrever(comMarcas ? 'print-marcas' : 'print-sangria', html), { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    await p.pdf({ path: path.join(OUT, nome), printBackground: true, preferCSSPageSize: true })
    await p.close()
    registrar(nome)
  }

  {
    const p = await navegador.newPage()
    await p.goto(escrever('selo', selo(cfg)), { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    await p.pdf({ path: path.join(OUT, 'ArenaHub-Selo-Adesivo-40mm.pdf'), printBackground: true, preferCSSPageSize: true })
    await p.close()
    registrar('ArenaHub-Selo-Adesivo-40mm.pdf')

    const pv = await navegador.newPage({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 1 })
    await pv.goto(escrever('selo-preview', selo(cfg)), { waitUntil: 'networkidle' })
    await pv.evaluate(() => document.fonts.ready)
    await pv.locator('svg').screenshot({ path: path.join(OUT, 'preview-3-selo.png') })
    await pv.close()
    registrar('preview-3-selo.png')
  }

  // ---------------------------------------------------------------- digitais
  for (const [largura, altura, story, nome] of [
    [1080, 1350, false, 'ArenaHub-Convite-WhatsApp-1080x1350.png'],
    [1080, 1920, true, 'ArenaHub-Convite-Story-1080x1920.png'],
  ]) {
    const p = await navegador.newPage({ viewport: { width: largura, height: altura }, deviceScaleFactor: 1 })
    await p.goto(escrever(`digital-${largura}x${altura}`, pecaDigital({ cfg, qrInstagram: ig.svg, largura, altura, story })), {
      waitUntil: 'networkidle',
    })
    await p.evaluate(() => document.fonts.ready)
    await p.screenshot({ path: path.join(OUT, nome) })
    await p.close()
    registrar(nome)
  }

  // --------------------------------------------------------------------- QA
  // Cada QR rasterizado sozinho no tamanho físico exato em que vai ser impresso,
  // a 300 dpi. É o arquivo que o verify.js decodifica: testa o código como ele
  // sai do papel, sem depender de onde ele está na página.
  {
    const qa = path.join(OUT, 'qa')
    fs.mkdirSync(qa, { recursive: true })
    const alvos = [
      ['qa-qr-instagram.png', ig.svg, QR_IMPRESSO.contracapa.utilMm],
      ['qa-qr-whatsapp.png', qrWhatsappDe(cfg.arenas[0]), QR_IMPRESSO.whatsapp.utilMm],
      ['qa-qr-criar.png', criar.svg, QR_IMPRESSO.interna.utilMm],
    ]
    for (const [nome, svg, mm] of alvos) {
      const px = Math.round((mm / 25.4) * 300) // 300 dpi
      const p = await navegador.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 })
      await p.setContent(`<style>*{margin:0;padding:0}svg{width:${px}px;height:${px}px;display:block}</style>${svg}`)
      await p.screenshot({ path: path.join(qa, nome) })
      await p.close()
      console.log(`QA ${nome} · ${mm.toFixed(1)} mm a 300 dpi = ${px}px`)
    }
  }

  // ---------------------------------------------------------------- previews
  // Mesma arte sem marcas, rasterizada a 300 dpi exatos (96 dpi de CSS × 3,125).
  // Serve para conferir na tela e como arquivo de reserva, caso a gráfica prefira
  // receber a peça achatada em imagem em vez do PDF vetorial.
  {
    const html = documentoPrint({ cfg, qrInstagram: ig.svg, qrCriar: criar.svg, qrWhatsappDe, comMarcas: false })
    const p = await navegador.newPage({ viewport: { width: 1160, height: 600 }, deviceScaleFactor: 300 / 96 })
    await p.goto(escrever('preview', html), { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    const paginas = await p.locator('.pagina').all()
    for (let i = 0; i < paginas.length; i++) {
      const nome = `preview-300dpi-${i === 0 ? '1-externa' : '2-interna'}.png`
      await paginas[i].screenshot({ path: path.join(OUT, nome) })
      registrar(nome)
    }
    await p.close()
  }

  // ------------------------------------------------------- ficha de produção
  // Folha A4 clara para mandar no WhatsApp da gráfica junto com o PDF. Vem
  // depois dos previews porque embute as duas páginas como miniatura.
  {
    const mini = ['preview-300dpi-1-externa.png', 'preview-300dpi-2-interna.png'].map(
      (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, f)).toString('base64')
    )
    for (const { nome, tiragem, acabamentoCompleto } of cfg.fichas) {
      const p = await navegador.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 })
      await p.goto(escrever(`ficha-${tiragem}`, fichaProducao(cfg, { tiragem, acabamentoCompleto, miniaturas: mini })), {
        waitUntil: 'networkidle',
      })
      await p.evaluate(() => document.fonts.ready)
      await p.screenshot({ path: path.join(OUT, nome) })
      await p.close()
      registrar(nome)
    }
  }

  await navegador.close()
  limpar()

  console.log('\nGerado em out/:')
  for (const g of gerados) console.log('  ' + g)
}

main().catch((e) => {
  limpar()
  console.error(e)
  process.exit(1)
})
