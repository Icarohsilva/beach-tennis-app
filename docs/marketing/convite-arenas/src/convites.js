// Gera os convites de um lote, com o nome de cada arena impresso na capa.
//
//   npm run convites                          usa a lista de src/config.js
//   npm run convites -- "Aloha Beach" "Arena Fahel"
//
// A ideia é imprimir só o que vai ser entregue naquela semana, em vez de rodar
// cem peças em branco. Sai um PDF por arena (para reimprimir uma sozinha) e um
// PDF com o lote inteiro, que é o que a gráfica prefere receber.
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const cfg = require('./config')
const { qrSvg } = require('./qr')
const { documentoPrint, fichaProducao } = require('./art')

const SRC = __dirname
const OUT = path.join(SRC, '..', 'out', 'convites')
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || undefined

// "Aloha Beach" -> "Aloha-Beach". Acento vira letra simples para o nome do
// arquivo sobreviver a qualquer sistema no caminho até a gráfica.
const arquivoDe = (nome) =>
  nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function escrever(nome, html) {
  const p = path.join(SRC, `.tmp-${nome}.html`)
  fs.writeFileSync(p, html)
  return 'file://' + p
}

function limpar() {
  for (const f of fs.readdirSync(SRC)) {
    if (f.startsWith('.tmp-')) fs.unlinkSync(path.join(SRC, f))
  }
}

async function main() {
  const arenas = process.argv.slice(2).length ? process.argv.slice(2) : cfg.arenas
  if (!arenas || !arenas.length) {
    console.error('Nenhuma arena. Passe os nomes como argumento ou preencha cfg.arenas.')
    process.exit(1)
  }

  fs.mkdirSync(OUT, { recursive: true })
  const ig = qrSvg(cfg.qrInstagram, { logo: true })
  const criar = qrSvg(cfg.qrCriar, { logo: true })

  const navegador = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--font-render-hinting=none', '--force-color-profile=srgb'],
  })

  const gerar = async (nomeArquivo, lote, tag) => {
    const html = documentoPrint({ cfg, qrInstagram: ig.svg, qrCriar: criar.svg, comMarcas: true, arenas: lote })
    const p = await navegador.newPage()
    await p.goto(escrever(tag, html), { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    await p.pdf({ path: path.join(OUT, nomeArquivo), printBackground: true, preferCSSPageSize: true })
    await p.close()
    const kb = Math.round(fs.statSync(path.join(OUT, nomeArquivo)).size / 1024)
    console.log(`  ${nomeArquivo} (${kb} KB)`)
  }

  console.log(`Lote de ${arenas.length}:`)
  for (const arena of arenas) {
    await gerar(`ArenaHub-Convite-${arquivoDe(arena)}.pdf`, [arena], `un-${arquivoDe(arena)}`)
  }

  const loteNome = `ArenaHub-Convites-LOTE-${arenas.length}un.pdf`
  await gerar(loteNome, arenas, 'lote')
  console.log(`  ^ ${arenas.length * 2} páginas: cada par é um convite diferente`)

  // Miniatura da primeira capa, para conferir o nome antes de mandar imprimir.
  {
    const html = documentoPrint({
      cfg,
      qrInstagram: ig.svg,
      qrCriar: criar.svg,
      comMarcas: false,
      arenas: [arenas[0]],
    })
    const p = await navegador.newPage({ viewport: { width: 1160, height: 600 }, deviceScaleFactor: 2 })
    await p.goto(escrever('capa-preview', html), { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    await p.locator('.pagina').first().screenshot({ path: path.join(OUT, 'preview-capa.png') })
    await p.close()
    console.log('  preview-capa.png (confira o nome antes de imprimir)')
  }

  // Ficha da gráfica com a contagem certa do lote.
  {
    const p = await navegador.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 })
    const mini = ['preview-300dpi-1-externa.png', 'preview-300dpi-2-interna.png']
      .map((f) => path.join(SRC, '..', 'out', f))
      .filter((f) => fs.existsSync(f))
      .map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'))
    await p.goto(
      escrever(
        'ficha-lote',
        fichaProducao(cfg, { tiragem: arenas.length, acabamentoCompleto: false, miniaturas: mini, personalizado: true })
      ),
      { waitUntil: 'networkidle' }
    )
    await p.evaluate(() => document.fonts.ready)
    const nome = `ArenaHub-Ficha-Grafica-LOTE-${arenas.length}un.png`
    await p.screenshot({ path: path.join(OUT, nome) })
    await p.close()
    console.log(`  ${nome}`)
  }

  await navegador.close()
  limpar()
  console.log(`\nEm out/convites/. Arenas: ${arenas.join(', ')}`)
}

main().catch((e) => {
  limpar()
  console.error(e)
  process.exit(1)
})
