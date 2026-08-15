// Toda a arte do convite. Nada aqui é imagem rasterizada: é HTML/SVG renderizado
// pelo Chromium, então o PDF sai vetorial e o texto continua sendo texto.
const fs = require('fs')
const path = require('path')

const FONTES = fs.readFileSync(path.join(__dirname, 'assets/fonts.css'), 'utf8')

// ---------------------------------------------------------------- primitivas

// Símbolo oficial do ArenaHub, redesenhado em vetor a partir de
// public/brand/arenahub-symbol-transparent.png (o PNG é raster e não serve para
// impressão): quadrado laranja, "A" vazado e a bola âmbar.
const SIMBOLO = (comBola = true) => `
  <rect width="100" height="100" rx="26" fill="#ea580c"/>
  ${comBola ? '<circle cx="72" cy="33" r="8.6" fill="#fbbf24"/>' : ''}
  <path fill-rule="evenodd" fill="#ffffff" d="M41,32.5 H53 L72,73.5 H59.8 L53.4,56.5 H40.6 L34.2,73.5 H22 Z M47,41.5 L43.2,52 H50.8 Z"/>`

// A unidade é parâmetro: o impresso raciocina em mm, as peças de tela em px.
// Misturar os dois foi o que já estourou o logo antes.
const marca = (altura, un, corTexto = '#ffffff') => `
<span style="display:inline-flex;align-items:center;gap:${altura * 0.34}${un}">
  <svg width="${altura}${un}" height="${altura}${un}" viewBox="0 0 100 100" style="display:block">${SIMBOLO()}</svg>
  <span style="font-family:Sora;font-weight:800;font-size:${altura * 0.66}${un};letter-spacing:-0.03em;color:${corTexto}">Arena<span style="color:#f97316">Hub</span></span>
</span>`

const logo = (alturaMm, corTexto) => marca(alturaMm, 'mm', corTexto)
const logoPx = (alturaPx, corTexto) => marca(alturaPx, 'px', corTexto)

// Quadra de beach tennis em perspectiva, o "chão" da peça.
// `id` precisa ser único: dois SVGs na mesma página com o mesmo id de gradiente
// fazem o segundo herdar o primeiro.
// Duas geometrias, não uma esticada: a faixa da capa é muito mais baixa que
// larga, e reaproveitar a quadra "normal" ali achata a perspectiva até virar
// dois riscos diagonais sem leitura.
const GEO = {
  normal: { h: 200, fundo: 40, frente: 190, fx: [120, 280], nx: [10, 390], rede: 0.4, alturaRede: 22 },
  larga: { h: 120, fundo: 18, frente: 112, fx: [140, 260], nx: [10, 390], rede: 0.42, alturaRede: 16 },
}

let seqQuadra = 0
const quadra = (opacidade = 0.22, esmaecer = true, forma = 'normal') => {
  const g = GEO[forma]
  const id = `q${++seqQuadra}`
  const t = g.rede
  const yRede = g.fundo + (g.frente - g.fundo) * t
  const xEsq = g.fx[0] + (g.nx[0] - g.fx[0]) * t
  const xDir = g.fx[1] + (g.nx[1] - g.fx[1]) * t
  const topoRede = yRede - g.alturaRede

  return `
<svg viewBox="0 0 400 ${g.h}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;opacity:${opacidade}">
  <defs>
    <!-- userSpaceOnUse é obrigatório: no modo padrão (objectBoundingBox) uma
         linha horizontal tem bbox de altura zero, o gradiente fica indefinido e
         o traço simplesmente não desenha, e some a rede inteira da quadra. -->
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${g.h}">
      ${
        esmaecer
          ? `<stop offset="0" stop-color="#f97316" stop-opacity="0"/>
             <stop offset="0.4" stop-color="#f97316" stop-opacity="0.8"/>
             <stop offset="1" stop-color="#f97316" stop-opacity="1"/>`
          : `<stop offset="0" stop-color="#f97316" stop-opacity="1"/>
             <stop offset="1" stop-color="#f97316" stop-opacity="1"/>`
      }
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#${id})" stroke-width="1.6" stroke-linecap="round">
    <path d="M${g.fx[0]} ${g.fundo} L${g.fx[1]} ${g.fundo} L${g.nx[1]} ${g.frente} L${g.nx[0]} ${g.frente} Z"/>
    <line x1="${xEsq.toFixed(1)}" y1="${yRede.toFixed(1)}" x2="${xDir.toFixed(1)}" y2="${yRede.toFixed(1)}"/>
    <line x1="${xEsq.toFixed(1)}" y1="${yRede.toFixed(1)}" x2="${xEsq.toFixed(1)}" y2="${topoRede.toFixed(1)}"/>
    <line x1="${xDir.toFixed(1)}" y1="${yRede.toFixed(1)}" x2="${xDir.toFixed(1)}" y2="${topoRede.toFixed(1)}"/>
    <line x1="${xEsq.toFixed(1)}" y1="${topoRede.toFixed(1)}" x2="${xDir.toFixed(1)}" y2="${topoRede.toFixed(1)}"/>
  </g>
  <g stroke="url(#${id})" stroke-width="0.7" opacity="0.5">
    ${Array.from({ length: 13 }, (_, i) => {
      const x = xEsq + ((xDir - xEsq) / 12) * i
      return `<line x1="${x.toFixed(1)}" y1="${topoRede.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yRede.toFixed(1)}"/>`
    }).join('')}
    ${[0.34, 0.67]
      .map((f) => {
        const y = topoRede + g.alturaRede * f
        return `<line x1="${xEsq.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xDir.toFixed(1)}" y2="${y.toFixed(1)}"/>`
      })
      .join('')}
  </g>
</svg>`
}

// Geometria dos QR impressos, em mm. Fica aqui porque o verify.js usa os mesmos
// números para calcular o tamanho do módulo. Mudar o layout sem mudar isto
// faria o QA validar uma peça que não existe mais.
const QR_IMPRESSO = {
  contracapa: { painelMm: 66, padMm: 5 },
  interna: { caixaMm: 28, padMm: 1.4 },
}
QR_IMPRESSO.contracapa.utilMm = QR_IMPRESSO.contracapa.painelMm - QR_IMPRESSO.contracapa.padMm * 2
QR_IMPRESSO.interna.utilMm = QR_IMPRESSO.interna.caixaMm - QR_IMPRESSO.interna.padMm * 2

const icone = {
  grade: `<rect x="3" y="5" width="18" height="16" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="12" y1="14" x2="12" y2="17"/><line x1="12" y1="17" x2="14.5" y2="17"/>`,
  parceiro: `<path d="M12 2.5 20 6v6c0 4.6-3.2 8.3-8 9.5-4.8-1.2-8-4.9-8-9.5V6z"/><polyline points="8.5,12 11,14.5 15.8,9.6"/>`,
  financeiro: `<line x1="3" y1="20.5" x2="21" y2="20.5"/><rect x="5" y="12" width="3.4" height="8"/><rect x="10.3" y="7.5" width="3.4" height="12.5"/><rect x="15.6" y="4" width="3.4" height="16"/>`,
  torneio: `<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5v1.5a3 3 0 0 0 3 3"/><path d="M17 5.5h2.5v1.5a3 3 0 0 1-3 3"/><line x1="12" y1="14" x2="12" y2="17"/><path d="M8.5 20.5h7l-.8-3h-5.4z"/>`,
}

const cardIcone = (nome, tamMm = 5.2) => `
<svg width="${tamMm}mm" height="${tamMm}mm" viewBox="0 0 24 24" fill="none" stroke="#f97316"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block">${icone[nome]}</svg>`

// ------------------------------------------------------------------- estilos

const baseCss = (c) => `
${FONTES}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{background:#5b6478;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.fundo{
  background:${c.fundo};
  background-image:
    radial-gradient(120% 90% at 88% -12%, rgba(249,115,22,.22) 0%, rgba(249,115,22,0) 58%),
    radial-gradient(90% 70% at 6% 108%, rgba(37,99,235,.14) 0%, rgba(37,99,235,0) 60%),
    linear-gradient(${c.borda} .18mm, transparent .18mm),
    linear-gradient(90deg, ${c.borda} .18mm, transparent .18mm);
  background-size:100% 100%, 100% 100%, 6mm 6mm, 6mm 6mm;
  background-position:0 0, 0 0, 0 0, 0 0;
}
.grid-suave::after{content:'';position:absolute;inset:0;background:inherit;opacity:.35;pointer-events:none}
.rotulo{font-family:Inter;font-weight:600;font-size:2.5mm;letter-spacing:.22em;text-transform:uppercase;color:${c.suave}}
.filete{height:.25mm;background:linear-gradient(90deg,${c.laranja},rgba(249,115,22,0));border-radius:1mm}
.manuscrito{font-family:Caveat,cursive;font-weight:700;color:${c.laranja}}
`

// ------------------------------------------------------------- painéis 150mm

function capa(cfg, arena) {
  const c = cfg.cor
  // Nome longo não pode quebrar o desenho: o corpo cai por faixa de tamanho.
  const n = (arena || '').length
  const corpoNome = n === 0 ? 0 : n <= 16 ? 13.5 : n <= 22 ? 11 : n <= 28 ? 9 : 7.5

  const destinatario = arena
    ? `<div style="margin-top:2mm">
         <div style="font-family:Playfair;font-weight:500;font-size:${corpoNome}mm;line-height:1.12;color:${c.texto};letter-spacing:-0.005em">${arena}</div>
         <div style="margin-top:3mm;width:34mm;height:.4mm;background:${c.laranja}"></div>
       </div>`
    : `<div>
         <div style="margin-top:2mm;width:100mm;border-bottom:.35mm dashed rgba(148,163,184,.55);height:9.5mm"></div>
         <div style="margin-top:1.4mm;font-family:Inter;font-size:2.3mm;color:rgba(148,163,184,.6)">escreva aqui o nome da arena</div>
       </div>`

  return `
<div class="painel capa" style="position:relative;overflow:hidden">
  <!-- Sem véu por cima do painel: qualquer overlay que cubra só metade da folha
       aparece como uma emenda visível na linha do vinco. -->
  <div style="position:absolute;left:-10mm;right:-10mm;bottom:15mm;height:31mm">${quadra(0.36, false, 'larga')}</div>

  <div style="position:relative;height:100%;padding:12mm 13mm 11mm;display:flex;flex-direction:column">
    ${logo(7.4)}

    <!-- A metade direita, na altura do meio, fica livre: é onde o selo adesivo
         de 40 mm lacra a peça. -->
    <div style="margin-top:13mm">
      <div style="display:flex;align-items:center;gap:3mm">
        <span style="font-family:Inter;font-weight:700;font-size:2.7mm;letter-spacing:.42em;color:${c.laranja}">CONVITE</span>
        <span class="filete" style="width:24mm"></span>
      </div>

      <div style="margin-top:8mm;font-family:Inter;font-weight:400;font-size:4.2mm;color:${c.suave}">Para a</div>
      ${destinatario}

      <h1 style="margin-top:8mm;width:112mm;font-family:Sora;font-weight:800;font-size:8.2mm;line-height:1.15;letter-spacing:-0.03em;color:${c.texto}">
        ser uma das primeiras arenas de ${cfg.cidade} no <span style="color:${c.laranja}">ArenaHub</span>.
      </h1>
    </div>

    <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
      <div style="font-family:Inter;font-weight:500;font-size:2.7mm;color:${c.suave};letter-spacing:.02em">
        ${cfg.cidade} · ${cfg.ano}
      </div>
      <div style="font-family:Inter;font-weight:600;font-size:2.7mm;color:${c.laranja}">${cfg.site}</div>
    </div>
  </div>
</div>`
}

function contracapa(cfg, qrInstagram) {
  const c = cfg.cor
  return `
<div class="painel contracapa" style="position:relative;overflow:hidden">
  <div style="position:relative;height:100%;padding:13mm 13mm 11mm;display:flex;flex-direction:column;align-items:center">
    <div style="align-self:flex-start">${logo(6.2)}</div>

    <div style="margin-top:9mm;text-align:center">
      <div style="font-family:Sora;font-weight:700;font-size:5.2mm;line-height:1.2;color:${c.texto};letter-spacing:-.02em">
        Aponte a câmera
      </div>
      <div style="margin-top:1.6mm;font-family:Inter;font-weight:600;font-size:2.5mm;letter-spacing:.24em;color:${c.laranja}">VEJA O SISTEMA POR DENTRO</div>
    </div>

    <!-- Painel claro: QR escuro sobre fundo claro é a combinação mais confiável
         de leitura. Nunca inverta para o dark do app. -->
    <div style="margin-top:5.5mm;width:${QR_IMPRESSO.contracapa.painelMm}mm;background:${c.claro};border-radius:4.4mm;padding:${QR_IMPRESSO.contracapa.padMm}mm ${QR_IMPRESSO.contracapa.padMm}mm 4mm;text-align:center;box-shadow:0 0 0 .5mm rgba(249,115,22,.55)">
      <div style="width:100%;aspect-ratio:1/1">${qrInstagram}</div>
      <div style="margin-top:2.6mm;font-family:Sora;font-weight:700;font-size:4mm;color:${c.fundo};letter-spacing:-.01em">${cfg.instagram}</div>
      <div style="margin-top:.8mm;font-family:Inter;font-weight:500;font-size:2.3mm;color:#64748b">telas reais, sem enfeite</div>
    </div>

    <div style="margin-top:auto;width:100%">
      <div style="height:.25mm;background:${c.borda};margin-bottom:4.5mm"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:4mm">
        <div>
          <div style="font-family:Sora;font-weight:700;font-size:3.4mm;color:${c.texto}">${cfg.fundador}</div>
          <div style="font-family:Inter;font-size:2.6mm;color:${c.suave};margin-top:.8mm">fundador do ArenaHub</div>
        </div>
        <div style="text-align:right;font-family:Inter;font-size:2.8mm;line-height:1.55;color:${c.suave}">
          <div style="color:${c.laranja};font-weight:600">${cfg.site}</div>
          <div>WhatsApp ${cfg.whatsapp}</div>
        </div>
      </div>
    </div>
  </div>
</div>`
}

// As três dores vêm da própria landing (seção "Você reconhece isso?"), que já é
// copy testada. A peça fala do problema do dono, não da história de quem fez.
const DORES = [
  [
    '“Sobrou vaga? Posso ir?”',
    'Você passa o dia respondendo a mesma pergunta no WhatsApp. E ainda perde o aluno que ia repor a aula.',
  ],
  [
    'O caderno vira caos.',
    'Quem pagou, quem deve, quem tem crédito. A planilha trava, o caderno some e a recepção pira.',
  ],
  [
    'A inadimplência fica invisível.',
    'Cobrar mensalidade é desconfortável. Sem ferramenta, vira “depois eu te mando” que nunca vem.',
  ],
]

const RECURSOS = [
  ['grade', 'Grade e reposição', 'O aluno reserva, cancela e repõe sozinho. A fila de espera preenche a vaga.'],
  ['parceiro', 'Wellhub e TotalPass', 'O check-in do parceiro cai direto no sistema, sem fila na recepção.'],
  ['financeiro', 'Financeiro sem climão', 'Mensalidade, avulsa e crédito: quem pagou e quem deve, sem cobrar na mão.'],
  ['torneio', 'Torneios e comunidade', 'Do chaveamento ao PIX da inscrição, e o feed que segura o aluno.'],
]

function interna(cfg, qrCriar) {
  const c = cfg.cor

  const dores = DORES.map(
    ([titulo, texto]) => `
    <div style="border-left:.6mm solid ${c.laranja};padding-left:4.5mm">
      <div style="font-family:Sora;font-weight:700;font-size:4.1mm;line-height:1.22;color:${c.texto};letter-spacing:-0.02em">${titulo}</div>
      <div style="margin-top:1.6mm;font-family:Inter;font-size:2.95mm;line-height:1.45;color:#cbd5e1">${texto}</div>
    </div>`
  ).join('')

  const cards = RECURSOS.map(
    ([ic, titulo, texto]) => `
    <div style="background:${c.card};border:.25mm solid ${c.borda};border-radius:3.4mm;padding:4mm 4.2mm">
      <div style="display:flex;align-items:center;gap:2.2mm">
        ${cardIcone(ic, 4.8)}
        <div style="font-family:Sora;font-weight:700;font-size:3.4mm;color:${c.texto};letter-spacing:-0.01em">${titulo}</div>
      </div>
      <div style="margin-top:2mm;font-family:Inter;font-size:2.7mm;line-height:1.45;color:${c.suave}">${texto}</div>
    </div>`
  ).join('')

  return `
<div class="painel" style="position:relative;overflow:hidden;width:300mm">
  <!-- Sem quadra aqui de propósito: esticada na abertura inteira ela vira um
       risco diagonal atravessando o texto. A parte de dentro é leitura, e
       leitura pede fundo quieto. -->

  <div style="position:relative;height:100%;display:flex;flex-direction:column;padding:13mm 15mm 11mm">
    <div style="display:flex;gap:36mm;flex:1">

      <!-- AS DORES (abre à esquerda) -->
      <div style="width:117mm;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:3mm">
          <span style="font-family:Inter;font-weight:700;font-size:2.5mm;letter-spacing:.3em;color:${c.laranja}">VOCÊ RECONHECE ISSO?</span>
        </div>
        <h2 style="margin-top:4mm;font-family:Sora;font-weight:800;font-size:6.2mm;line-height:1.14;letter-spacing:-0.03em;color:${c.texto}">
          Toda arena perde aluno<br>pelo mesmo motivo.
        </h2>
        <div style="margin-top:5.5mm;display:flex;flex-direction:column;gap:4mm">${dores}</div>
        <div style="margin-top:auto;padding-top:4mm;font-family:Inter;font-weight:600;font-size:3.1mm;line-height:1.45;color:${c.suave}">
          Não é desorganização sua. <span style="color:${c.texto}">É falta de ferramenta feita para arena.</span>
        </div>
      </div>

      <!-- A SOLUÇÃO (abre à direita) -->
      <div style="width:117mm;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:3mm">
          <span style="font-family:Inter;font-weight:700;font-size:2.5mm;letter-spacing:.3em;color:${c.laranja}">O QUE ENTRA NO LUGAR</span>
          <span class="filete" style="flex:1"></span>
        </div>
        <div style="margin-top:4.5mm;display:grid;grid-template-columns:1fr 1fr;gap:3mm">${cards}</div>

        <!-- O suporte tem card próprio, atravessando as duas colunas: é a
             objeção número um de quem nunca usou sistema nenhum. -->
        <div style="margin-top:3mm;background:rgba(249,115,22,.1);border:.3mm solid rgba(249,115,22,.55);border-radius:3.4mm;padding:4mm 4.6mm">
          <div style="display:flex;align-items:center;gap:2.2mm">
            <svg width="4.8mm" height="4.8mm" viewBox="0 0 24 24" fill="none" stroke="${c.laranja}" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round" style="display:block">
              <path d="M21 11.5a8.4 8.4 0 0 1-12.1 7.5L3 20.5l1.6-5.7A8.4 8.4 0 1 1 21 11.5z"/>
            </svg>
            <div style="font-family:Sora;font-weight:700;font-size:3.4mm;color:${c.texto};letter-spacing:-0.01em">Você não vai fazer isso sozinho</div>
          </div>
          <div style="margin-top:2mm;font-family:Inter;font-size:2.7mm;line-height:1.45;color:#e2e8f0">
            A gente configura suas turmas e cadastra seus alunos com você nos primeiros acessos.
            E o suporte no WhatsApp é <b style="color:${c.laranja}">vitalício</b>, sempre que precisar.
          </div>
        </div>
      </div>
    </div>

    <!-- FAIXA DE PREÇO: atravessa a peça, mas o vão de 36 mm garante que nada
         caia em cima do vinco (x = 150 mm). -->
    <div style="margin-top:6mm;display:flex;align-items:stretch;gap:36mm">
      <div style="width:117mm;background:linear-gradient(135deg,${c.laranjaEscuro},${c.laranjaProfundo});border-radius:3.6mm;padding:3.6mm 4.6mm;display:flex;flex-direction:column;justify-content:center">
        <div style="display:flex;align-items:baseline;gap:2.4mm">
          <span style="font-family:Sora;font-weight:800;font-size:10mm;letter-spacing:-0.035em;color:#fff;line-height:1">${cfg.preco}</span>
          <span style="font-family:Sora;font-weight:700;font-size:4.4mm;color:rgba(255,255,255,.82)">${cfg.precoUnidade}</span>
        </div>
        <div style="margin-top:2.2mm;display:flex;flex-wrap:wrap;gap:1.2mm 1.8mm">
          ${cfg.garantias
            .map(
              (g) =>
                `<span style="font-family:Inter;font-weight:600;font-size:2.5mm;color:#fff;border:.22mm solid rgba(255,255,255,.42);border-radius:9mm;padding:1mm 2.6mm;background:rgba(255,255,255,.12)">${g}</span>`
            )
            .join('')}
        </div>
      </div>

      <div style="width:117mm;display:flex;align-items:center;gap:5mm;background:${c.card};border:.25mm solid ${c.borda};border-radius:3.6mm;padding:3.6mm 4.6mm">
        <div style="flex:1">
          <div style="font-family:Sora;font-weight:700;font-size:4.4mm;color:${c.texto};line-height:1.24;letter-spacing:-0.015em">
            Crie sua conta<br>em 5 minutos
          </div>
          <div style="margin-top:2mm;font-family:Inter;font-size:2.6mm;color:${c.suave}">
            ${cfg.site}<span style="color:${c.laranja}">/criar-academia</span>
          </div>
        </div>
        <div style="width:${QR_IMPRESSO.interna.caixaMm}mm;height:${QR_IMPRESSO.interna.caixaMm}mm;background:${c.claro};border-radius:2.6mm;padding:${QR_IMPRESSO.interna.padMm}mm;flex:none">${qrCriar}</div>
      </div>
    </div>
  </div>
</div>`
}

// ------------------------------------------------------ folhas gráficas

/**
 * Monta uma folha de impressão: área de arte com sangria e, opcionalmente,
 * marcas de corte, marca de vinco e barra de informação para a gráfica.
 */
function folha({ cfg, conteudo, comMarcas, rotulo }) {
  const { aberto, altura, sangria, marcaFolga } = cfg.print
  const artW = aberto + sangria * 2
  const artH = altura + sangria * 2
  const pgW = comMarcas ? artW + marcaFolga * 2 : artW
  const pgH = comMarcas ? artH + marcaFolga * 2 : artH
  const off = comMarcas ? marcaFolga : 0

  // Marcas de corte: começam na borda da sangria e apontam para fora (padrão gráfico).
  const traco = (style) =>
    `<div style="position:absolute;background:#000;${style}"></div>`
  const marcas = !comMarcas
    ? ''
    : (() => {
        const L = off + sangria // x do corte esquerdo
        const R = off + sangria + aberto
        const T = off + sangria
        const B = off + sangria + altura
        const c = 6 // comprimento da marca
        const g = 1 // folga entre marca e corte
        const m = []
        for (const x of [L, R]) {
          m.push(traco(`left:${x}mm;top:${T - sangria - g - c}mm;width:.2mm;height:${c}mm`))
          m.push(traco(`left:${x}mm;top:${B + sangria + g}mm;width:.2mm;height:${c}mm`))
        }
        for (const y of [T, B]) {
          m.push(traco(`top:${y}mm;left:${L - sangria - g - c}mm;height:.2mm;width:${c}mm`))
          m.push(traco(`top:${y}mm;left:${R + sangria + g}mm;height:.2mm;width:${c}mm`))
        }
        // Marca de vinco/dobra no centro, tracejada para não confundir com corte.
        const X = off + sangria + aberto / 2
        m.push(
          `<div style="position:absolute;left:${X}mm;top:${T - sangria - g - c}mm;width:.2mm;height:${c}mm;background:repeating-linear-gradient(180deg,#000 0 1mm,transparent 1mm 2mm)"></div>`
        )
        m.push(
          `<div style="position:absolute;left:${X}mm;top:${B + sangria + g}mm;width:.2mm;height:${c}mm;background:repeating-linear-gradient(180deg,#000 0 1mm,transparent 1mm 2mm)"></div>`
        )
        m.push(
          `<div style="position:absolute;left:${X + 1.2}mm;top:${B + sangria + g + 1}mm;font:600 2.2mm Inter,sans-serif;color:#000;white-space:nowrap">VINCO / DOBRA</div>`
        )
        return m.join('')
      })()

  const barra = !comMarcas
    ? ''
    : `<div style="position:absolute;left:${off}mm;top:${off - 6.5}mm;width:${artW}mm;display:flex;justify-content:space-between;font:500 2.3mm Inter,sans-serif;color:#000">
         <span>ArenaHub · Convite Arenas · ${rotulo}</span>
         <span>Corte 300×150 mm · sangria 3 mm · vinco no centro (150 mm) · 4/4</span>
       </div>
       <div style="position:absolute;left:${off + artW / 2 - 4}mm;top:${off + artH + 2.5}mm;font:700 2.4mm Inter,sans-serif;color:#000">↑ TOPO</div>`

  return `
<div class="pagina" style="position:relative;width:${pgW}mm;height:${pgH}mm;background:#fff;overflow:hidden">
  ${marcas}${barra}
  <div class="fundo" style="position:absolute;left:${off}mm;top:${off}mm;width:${artW}mm;height:${artH}mm;overflow:hidden">
    <div style="position:absolute;left:${sangria}mm;top:${sangria}mm;width:${aberto}mm;height:${altura}mm;display:flex">
      ${conteudo}
    </div>
  </div>
</div>`
}

function documentoPrint({ cfg, qrInstagram, qrCriar, comMarcas, arenas = [null] }) {
  const { aberto, altura, sangria, marcaFolga } = cfg.print
  const pgW = aberto + sangria * 2 + (comMarcas ? marcaFolga * 2 : 0)
  const pgH = altura + sangria * 2 + (comMarcas ? marcaFolga * 2 : 0)
  const painelCss = `.painel{width:150mm;height:150mm;flex:none}`

  // Cada arena vira duas páginas. Um único PDF com o lote inteiro é o que a
  // gráfica quer receber; o nome vai no rótulo de cada folha para não trocarem
  // a ordem na hora de casar frente e verso.
  const folhas = arenas
    .map((arena) => {
      const quem = arena ? ` · ${arena}` : ''
      return (
        folha({
          cfg,
          comMarcas,
          rotulo: `PÁG. 1 · EXTERNA (capa à direita)${quem}`,
          conteudo: contracapa(cfg, qrInstagram) + capa(cfg, arena),
        }) +
        folha({
          cfg,
          comMarcas,
          rotulo: `PÁG. 2 · INTERNA (dores à esquerda)${quem}`,
          conteudo: interna(cfg, qrCriar),
        })
      )
    })
    .join('')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ArenaHub · Convite</title>
<style>
${baseCss(cfg.cor)}
${painelCss}
@page{size:${pgW}mm ${pgH}mm;margin:0}
body{background:#fff}
.pagina{break-after:page}
.pagina:last-child{break-after:auto}
</style></head><body>
${folhas}
</body></html>`
}

// ------------------------------------------------------------------ digitais

function pecaDigital({ cfg, qrInstagram, largura, altura, story }) {
  const c = cfg.cor
  // Story tem 570px a mais de altura: sobra vira respiro, não corpo maior.
  const pad = 76
  const respiro = story ? 1.9 : 1

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ArenaHub · Convite digital</title>
<style>
${baseCss(c)}
html,body{width:${largura}px;height:${altura}px;overflow:hidden}
</style></head><body>
<div class="fundo" style="position:relative;width:${largura}px;height:${altura}px;overflow:hidden;
     background-size:100% 100%,100% 100%,44px 44px,44px 44px">

  <!-- Quadra na faixa de baixo, sem véu por cima: o texto que passa por ali é
       branco em peso 800 e aguenta o fundo. -->
  <div style="position:absolute;left:-40px;right:-40px;bottom:0;height:${story ? 520 : 430}px">${quadra(0.15, false, 'larga')}</div>

  <div style="position:relative;height:100%;padding:${pad}px;display:flex;flex-direction:column;${story ? 'justify-content:space-between' : ''}">

    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px">
      ${logoPx(58)}
      <span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:.3em;color:${c.laranja};border:2px solid rgba(249,115,22,.4);border-radius:100px;padding:10px 20px;white-space:nowrap">CONVITE</span>
    </div>

    <div style="margin-top:${Math.round(64 * respiro)}px">
      <div style="display:flex;align-items:center;gap:20px">
        <span class="filete" style="width:80px;height:3px"></span>
        <span style="font-family:Inter;font-weight:600;font-size:23px;letter-spacing:.18em;color:${c.suave};text-transform:uppercase">Para a sua arena</span>
      </div>
      <h1 style="margin-top:26px;font-family:Sora;font-weight:800;font-size:82px;line-height:1.07;letter-spacing:-0.035em;color:${c.texto}">
        Sua arena merece mais que um <span style="color:${c.laranja}">grupo de WhatsApp</span>.
      </h1>
      <p style="margin-top:28px;font-family:Inter;font-size:31px;line-height:1.5;color:#cbd5e1;max-width:830px">
        Grade, reposição, Wellhub, financeiro e torneios num app só.
        E o aluno para de te mandar “sobrou vaga?” às 22h.
      </p>
    </div>

    ${
      // O Story tem 570px a mais. Em vez de virar buraco antes do rodapé, vira
      // conteúdo: a mesma lista de recursos da parte interna do convite.
      story
        ? `<div style="margin-top:56px;display:flex;flex-direction:column;gap:26px">
             ${RECURSOS.map(
               ([ic, titulo]) => `
               <div style="display:flex;align-items:center;gap:20px">
                 <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="1.7"
                      stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none">${icone[ic]}</svg>
                 <span style="font-family:Sora;font-weight:700;font-size:33px;color:#e2e8f0;letter-spacing:-0.015em">${titulo}</span>
               </div>`
             ).join('')}
           </div>`
        : ''
    }

    <div style="margin-top:${Math.round(52 * respiro)}px;display:flex;align-items:center;gap:32px">
      <div style="background:${c.claro};border-radius:26px;padding:18px;flex:none;box-shadow:0 0 0 3px rgba(249,115,22,.6)">
        <div style="width:212px;height:212px">${qrInstagram}</div>
      </div>
      <div>
        <div style="font-family:Sora;font-weight:800;font-size:40px;color:${c.texto};letter-spacing:-0.02em;line-height:1.2">
          Aponte a câmera
        </div>
        <div style="margin-top:10px;font-family:Inter;font-size:28px;color:${c.suave};line-height:1.45">
          Telas reais do sistema<br>no ${cfg.instagram}
        </div>
      </div>
    </div>

    <!-- No feed a margem automática empurra o rodapé para baixo. No Story quem
         distribui a sobra é o space-between, e um margin-top:auto aqui comeria
         todo o espaço livre antes que ele pudesse distribuir. -->
    <div style="${story ? '' : 'margin-top:auto;'}padding-top:44px">
      <div style="height:2px;background:${c.borda};margin-bottom:30px"></div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:28px">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px">
            <span style="font-family:Sora;font-weight:800;font-size:70px;letter-spacing:-0.035em;color:${c.texto};line-height:1">${cfg.preco}</span>
            <span style="font-family:Sora;font-weight:700;font-size:31px;color:${c.laranja}">${cfg.precoUnidade}</span>
          </div>
          <div style="margin-top:14px;font-family:Inter;font-weight:600;font-size:25px;color:#e2e8f0">
            ${cfg.garantias.join(' · ')}
          </div>
        </div>
        <div style="text-align:right;font-family:Inter;font-size:25px;line-height:1.5;color:${c.suave};white-space:nowrap">
          <div style="color:${c.laranja};font-weight:700">${cfg.site}</div>
          <div>${cfg.fundador} · fundador</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`
}

// ---------------------------------------------------------------------- selo

function selo(cfg) {
  const c = cfg.cor
  const d = 40 // diâmetro final em mm
  const s = 3 // sangria
  const t = d + s * 2
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ArenaHub · Selo</title>
<style>${baseCss(c)}@page{size:${t}mm ${t}mm;margin:0}body{background:#fff}</style></head><body>
<div style="width:${t}mm;height:${t}mm">
  <svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c.laranja}"/><stop offset="1" stop-color="${c.laranjaProfundo}"/>
      </linearGradient>
      <!-- Arco de cima percorrido pelo topo; o de baixo percorrido PELO FUNDO,
           da esquerda para a direita (sweep 0). Reaproveitar o mesmo arco para
           os dois textos deixa o de baixo de cabeça para baixo. -->
      <path id="topo" d="M14,50 A36,36 0 0 1 86,50" fill="none"/>
      <path id="base" d="M14,50 A36,36 0 0 0 86,50" fill="none"/>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#g)"/>
    <circle cx="50" cy="50" r="42.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="0.7"/>
    <text font-family="Inter" font-weight="700" font-size="7.4" letter-spacing="3.4" fill="#fff">
      <textPath href="#topo" startOffset="50%" text-anchor="middle">CONVITE</textPath>
    </text>
    <text font-family="Inter" font-weight="700" font-size="6.2" letter-spacing="2.6" fill="#fff" fill-opacity=".85">
      <textPath href="#base" startOffset="50%" text-anchor="middle">ARENAHUB</textPath>
    </text>
    <!-- Só o "A" e a bola: o quadrado laranja da marca sumiria no selo laranja. -->
    <g transform="translate(20 20) scale(0.6)">
      <circle cx="72" cy="33" r="8.6" fill="#fbbf24"/>
      <path fill-rule="evenodd" fill="#ffffff" d="M41,32.5 H53 L72,73.5 H59.8 L53.4,56.5 H40.6 L34.2,73.5 H22 Z M47,41.5 L43.2,52 H50.8 Z"/>
    </g>
  </svg>
</div>
</body></html>`
}

// ------------------------------------------------------ ficha de produção
// Uma folha A4 clara para mandar no WhatsApp da gráfica junto com o PDF.
// Fundo branco de propósito: é documento técnico, não peça de marca, e o
// pré-impressão costuma imprimir isso para levar para a máquina.

/**
 * @param {object} cfg
 * @param {object} p
 * @param {number} p.tiragem        quantas unidades do convite
 * @param {boolean} p.acabamentoCompleto  false na prova pequena, onde soft touch
 *                                  e verniz localizado não compensam
 * @param {string[]} p.miniaturas   data URIs das duas páginas, para a gráfica ver
 *                                  o que está imprimindo sem abrir o PDF
 */
function fichaProducao(cfg, { tiragem, acabamentoCompleto = true, miniaturas = [], personalizado = false }) {
  const T = '#0f172a'
  const S = '#5b6b82'
  const L = '#d8dee8'
  const A = '#ea580c'

  const linha = (k, v, destaque = false) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${L};color:${S};font-size:15px;width:40%">${k}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${L};color:${destaque ? A : T};font-size:15px;font-weight:${destaque ? 700 : 500}">${v}</td>
    </tr>`

  const acabamento = acabamentoCompleto
    ? 'Laminação soft touch fosca 2 lados + verniz localizado (UV) só nos elementos laranja e no logo'
    : 'Laminação fosca 2 lados (soft touch se tiverem o filme). <b>Sem verniz localizado nesta prova.</b>'

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de produção</title>
<style>
${FONTES}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:1240px;height:1754px;background:#fff;font-family:Inter,sans-serif;color:${T}}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
h1{font-family:Sora;font-weight:800;letter-spacing:-0.03em;line-height:1.1}
</style></head><body>
<div style="padding:64px 72px;display:flex;flex-direction:column;height:100%">

  <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:22px;border-bottom:2px solid ${T}">
    ${logoPx(42, T)}
    <div style="text-align:right">
      <div style="font-family:Inter;font-weight:700;font-size:13px;letter-spacing:.22em;color:${A}">FICHA DE PRODUÇÃO</div>
      <div style="font-size:13px;color:${S};margin-top:3px">${cfg.cidade} · ${cfg.ano}</div>
    </div>
  </div>

  <h1 style="margin-top:30px;font-size:40px">Convite dobrado</h1>
  <div style="margin-top:8px;font-size:17px;color:${S}">
    Aberto <b style="color:${T}">300 × 150 mm</b> · fechado <b style="color:${T}">150 × 150 mm</b> ·
    tiragem <b style="color:${A}">${tiragem} ${tiragem === 1 ? 'unidade' : 'unidades'}</b>
  </div>
  ${
    personalizado
      ? `<div style="margin-top:14px;border:2px solid ${A};border-radius:8px;padding:12px 16px;font-size:15px;line-height:1.5;color:${T}">
           <b style="color:${A}">Atenção:</b> cada convite tem arte diferente (o nome da arena vai impresso na capa).
           O PDF tem <b>${tiragem * 2} páginas</b>, e <b>cada par de páginas é um convite</b>:
           a página ímpar é a externa e a página par seguinte é a interna correspondente. Não embaralhe a ordem ao casar frente e verso.
         </div>`
      : ''
  }

  <!-- Esquema com as cotas. Vale mais que qualquer parágrafo: a gráfica lê
       formato, dobra e sangria de uma vez. -->
  <div style="margin-top:34px">
    <svg viewBox="0 0 1096 420" style="width:100%;display:block">
      <g font-family="Inter" font-size="17" fill="${S}">
        <!-- sangria -->
        <rect x="60" y="34" width="976" height="308" fill="none" stroke="${A}" stroke-width="1.5" stroke-dasharray="7 6"/>
        <!-- corte -->
        <rect x="70" y="44" width="956" height="288" fill="#f4f6fa" stroke="${T}" stroke-width="2"/>
        <!-- vinco -->
        <line x1="548" y1="44" x2="548" y2="332" stroke="${A}" stroke-width="2" stroke-dasharray="9 7"/>
        <text x="548" y="30" text-anchor="middle" fill="${A}" font-weight="700">VINCO no centro, a 150 mm</text>
        <!-- metades -->
        <text x="309" y="180" text-anchor="middle" fill="${S}" font-size="16">metade esquerda</text>
        <text x="309" y="204" text-anchor="middle" fill="${S}" font-size="16">150 × 150 mm</text>
        <text x="787" y="180" text-anchor="middle" fill="${S}" font-size="16">metade direita</text>
        <text x="787" y="204" text-anchor="middle" fill="${S}" font-size="16">150 × 150 mm</text>
        <!-- cota horizontal -->
        <line x1="70" y1="372" x2="1026" y2="372" stroke="${T}" stroke-width="1.5"/>
        <line x1="70" y1="364" x2="70" y2="380" stroke="${T}" stroke-width="1.5"/>
        <line x1="1026" y1="364" x2="1026" y2="380" stroke="${T}" stroke-width="1.5"/>
        <rect x="470" y="358" width="156" height="28" fill="#fff"/>
        <text x="548" y="378" text-anchor="middle" fill="${T}" font-weight="700">300 mm</text>
        <!-- cota vertical -->
        <line x1="1062" y1="44" x2="1062" y2="332" stroke="${T}" stroke-width="1.5"/>
        <line x1="1054" y1="44" x2="1070" y2="44" stroke="${T}" stroke-width="1.5"/>
        <line x1="1054" y1="332" x2="1070" y2="332" stroke="${T}" stroke-width="1.5"/>
        <text x="1062" y="196" text-anchor="middle" fill="${T}" font-weight="700"
              transform="rotate(90 1062 196)">150 mm</text>
        <!-- sangria -->
        <text x="60" y="410" fill="${A}" font-size="15">- - -  sangria de 3 mm em todos os lados</text>
      </g>
    </svg>
  </div>

  <table style="margin-top:26px;width:100%;border-collapse:collapse">
    ${linha('Formato aberto', '300 × 150 mm')}
    ${linha('Formato fechado', '150 × 150 mm (1 dobra vertical central)')}
    ${linha('Dobra', 'Vinco mecânico ANTES de dobrar, no sentido das fibras', true)}
    ${linha('Papel', 'Couché fosco 300 g/m²')}
    ${linha('Impressão', '4/4, colorido frente e verso')}
    ${linha('Acabamento', acabamento)}
    ${linha('Sangria', '3 mm em todos os lados')}
    ${linha('Arquivo', 'PDF vetorial, 2 páginas (pág. 1 externa, pág. 2 interna), com marcas de corte')}
    ${linha('Aproveitamento', '2 peças por folha SRA3 (32 × 45 cm)')}
  </table>

  <div style="margin-top:26px;display:flex;gap:16px">
    <div style="flex:1;border:2px solid ${A};border-radius:10px;padding:18px 20px">
      <div style="font-family:Sora;font-weight:700;font-size:16px;color:${A}">1. Fundo em preto rico</div>
      <div style="margin-top:7px;font-size:14.5px;line-height:1.5;color:${T}">
        A peça é uma chapada escura quase preta. Monte nos quatro canais
        (referência C 75 · M 62 · Y 40 · K 85). Com 100% K sozinho sai cinza lavado.
      </div>
    </div>
    <div style="flex:1;border:2px solid ${A};border-radius:10px;padding:18px 20px">
      <div style="font-family:Sora;font-weight:700;font-size:16px;color:${A}">2. QR code sem verniz brilhante</div>
      <div style="margin-top:7px;font-size:14.5px;line-height:1.5;color:${T}">
        O painel branco do QR fica fosco. Verniz brilhante em cima dele cria
        reflexo e a câmera do celular deixa de ler.
      </div>
    </div>
  </div>

  ${
    miniaturas.length
      ? `<div style="margin-top:30px">
           <div style="font-family:Inter;font-weight:700;font-size:12px;letter-spacing:.2em;color:${S}">O QUE ESTÁ NO PDF</div>
           <!-- Lado a lado: empilhadas, duas peças de 300x150 estouram a A4. -->
           <div style="margin-top:12px;display:flex;gap:16px">
             ${miniaturas
               .map(
                 (src, i) => `
               <div style="flex:1;min-width:0">
                 <img src="${src}" style="width:100%;display:block;border:1px solid ${L};border-radius:4px">
                 <div style="margin-top:6px;font-size:12px;line-height:1.4;color:${S}">
                   <b style="color:${T}">Página ${i + 1}</b> · ${i === 0 ? 'externa (contracapa à esquerda, capa à direita)' : 'interna (a peça aberta)'}
                 </div>
               </div>`
               )
               .join('')}
           </div>
         </div>`
      : ''
  }

  <div style="margin-top:auto;padding-top:24px;border-top:1px solid ${L};display:flex;justify-content:space-between;font-size:14px;color:${S}">
    <span>ArenaHub · ${cfg.fundador}</span>
    <span>WhatsApp ${cfg.whatsapp} · ${cfg.site}</span>
  </div>
</div>
</body></html>`
}

module.exports = { documentoPrint, pecaDigital, selo, fichaProducao, baseCss, logo, logoPx, quadra, QR_IMPRESSO }
