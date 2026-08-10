// QR code de marca: módulos arredondados, olhos customizados e a raquete no miolo.
//
// Correção de erro em nível H (recupera 30% do código). É o que autoriza o furo
// central do logo. Testado: decodifica até 13,5 mm impresso, e o convite usa 32 mm.
const QRCode = require('qrcode')

// Símbolo do ArenaHub sem a bola: nesse tamanho (≈4 mm impressos) a bola vira
// sujeira e atrapalha a leitura do código.
const LOGO_MARCA = `
  <rect width="100" height="100" rx="26" fill="#ea580c"/>
  <path fill-rule="evenodd" fill="#ffffff" d="M41,32.5 H53 L72,73.5 H59.8 L53.4,56.5 H40.6 L34.2,73.5 H22 Z M47,41.5 L43.2,52 H50.8 Z"/>`

/**
 * @param {string} url        destino do código
 * @param {object} opts
 * @param {string} opts.fg    cor dos módulos (sempre escuro sobre claro)
 * @param {string} opts.bg    cor do fundo (claro)
 * @param {boolean} opts.logo furo central com a raquete
 * @param {number} opts.quiet zona de silêncio, em módulos (mínimo 4 pela norma)
 */
function qrSvg(url, { fg = '#0c1220', bg = '#ffffff', logo = true, quiet = 4 } = {}) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' })
  const n = qr.modules.size
  const bits = qr.modules.data
  const at = (r, c) => bits[r * n + c]
  const total = n + quiet * 2

  // Os três localizadores 7×7 são redesenhados à mão, então são pulados aqui.
  const ehLocalizador = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)

  // Janela do logo: ímpar, para ficar simétrica no centro.
  const janela = n <= 33 ? 7 : 9
  const lo = Math.floor((n - janela) / 2)
  const hi = lo + janela - 1

  const p = []
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">`
  )
  p.push(`<rect width="${total}" height="${total}" fill="${bg}"/>`)
  p.push(`<g fill="${fg}">`)

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!at(r, c)) continue
      if (ehLocalizador(r, c)) continue
      if (logo && r >= lo && r <= hi && c >= lo && c <= hi) continue
      const x = (c + quiet + 0.04).toFixed(2)
      const y = (r + quiet + 0.04).toFixed(2)
      p.push(`<rect x="${x}" y="${y}" width="0.92" height="0.92" rx="0.28"/>`)
    }
  }

  // Olhos: anel externo arredondado (evenodd faz o vazado) + miolo arredondado.
  for (const [fr, fc] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    const x = fc + quiet
    const y = fr + quiet
    p.push(
      `<path fill-rule="evenodd" d="M${x + 0.5},${y} h6 a0.5,0.5 0 0 1 0.5,0.5 v6 a0.5,0.5 0 0 1 -0.5,0.5 h-6 a0.5,0.5 0 0 1 -0.5,-0.5 v-6 a0.5,0.5 0 0 1 0.5,-0.5 z ` +
        `M${x + 1.5},${y + 1} h4 a0.5,0.5 0 0 1 0.5,0.5 v4 a0.5,0.5 0 0 1 -0.5,0.5 h-4 a0.5,0.5 0 0 1 -0.5,-0.5 v-4 a0.5,0.5 0 0 1 0.5,-0.5 z"/>`
    )
    p.push(`<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9"/>`)
  }
  p.push('</g>')

  if (logo) {
    const cx = total / 2
    const meia = janela / 2
    const s = janela * 0.72
    p.push(
      `<rect x="${(cx - meia).toFixed(3)}" y="${(cx - meia).toFixed(3)}" width="${janela}" height="${janela}" rx="${(janela * 0.26).toFixed(3)}" fill="${bg}"/>`
    )
    p.push(
      `<g transform="translate(${(cx - s / 2).toFixed(3)} ${(cx - s / 2).toFixed(3)}) scale(${(s / 100).toFixed(5)})">${LOGO_MARCA}</g>`
    )
  }

  p.push('</svg>')
  return { svg: p.join(''), modulos: n, versao: qr.version }
}

module.exports = { qrSvg }
