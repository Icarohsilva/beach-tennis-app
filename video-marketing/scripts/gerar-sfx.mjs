// -----------------------------------------------------------------------------
// Gera os efeitos sonoros do vídeo em ../public/audio/sfx/.
//
//   node scripts/gerar-sfx.mjs        (ou: npm run gerar:sfx)
//
// Por que sintetizar em vez de baixar: o vídeo é material de venda enviado a
// clientes. Efeito baixado de banco gratuito costuma vir com licença que exige
// atribuição, ou que muda depois — e reclamação de direito autoral em cima de
// vídeo comercial é um problema caro por um ganho pequeno. Som gerado aqui é
// nosso, e de quebra fica coerente entre si porque sai do mesmo material.
//
// Sem dependência nenhuma: o WAV é escrito na mão (cabeçalho RIFF de 44 bytes).
// -----------------------------------------------------------------------------
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const DESTINO = join(AQUI, '..', '..', 'public', 'audio', 'sfx')
const TAXA = 48000

// --- utilidades de sinal ------------------------------------------------------

const amostras = (segundos) => Math.round(segundos * TAXA)

/** Filtro passa-baixa de um polo. `corte` em Hz, avaliado amostra a amostra. */
const criaPassaBaixa = () => {
  let y = 0
  return (x, corte) => {
    const a = 1 - Math.exp((-2 * Math.PI * corte) / TAXA)
    y += (x - y) * a
    return y
  }
}

/** Passa-alta derivado do passa-baixa: o que sobra depois de tirar os graves. */
const criaPassaAlta = () => {
  const pb = criaPassaBaixa()
  return (x, corte) => x - pb(x, corte)
}

/** Interpolação exponencial — usada em varredura de frequência, que o ouvido
 *  percebe em escala logarítmica (linear soa como se acelerasse no fim). */
const varre = (t, de, ate) => de * Math.pow(ate / de, t)

/**
 * Normaliza para o pico desejado e aplica rampa de 3 ms nas pontas.
 * Sem a rampa, o corte seco no início e no fim vira um "toc" audível.
 */
const finaliza = (buf, pico = 0.85) => {
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  const ganho = max > 0 ? pico / max : 0
  const rampa = amostras(0.003)
  for (let i = 0; i < buf.length; i++) {
    const entrada = Math.min(1, i / rampa)
    const saida = Math.min(1, (buf.length - i) / rampa)
    buf[i] = buf[i] * ganho * Math.min(entrada, saida)
  }
  return buf
}

const escreveWav = (nome, buf) => {
  const dados = Buffer.alloc(buf.length * 2)
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]))
    dados.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const cabecalho = Buffer.alloc(44)
  cabecalho.write('RIFF', 0)
  cabecalho.writeUInt32LE(36 + dados.length, 4)
  cabecalho.write('WAVE', 8)
  cabecalho.write('fmt ', 12)
  cabecalho.writeUInt32LE(16, 16) // tamanho do bloco fmt
  cabecalho.writeUInt16LE(1, 20) // PCM
  cabecalho.writeUInt16LE(1, 22) // mono
  cabecalho.writeUInt32LE(TAXA, 24)
  cabecalho.writeUInt32LE(TAXA * 2, 28) // bytes por segundo
  cabecalho.writeUInt16LE(2, 32) // alinhamento de bloco
  cabecalho.writeUInt16LE(16, 34) // bits por amostra
  cabecalho.write('data', 36)
  cabecalho.writeUInt32LE(dados.length, 40)

  const caminho = join(DESTINO, nome)
  writeFileSync(caminho, Buffer.concat([cabecalho, dados]))
  const kb = ((44 + dados.length) / 1024).toFixed(0)
  console.log(`  ${nome.padEnd(14)} ${(buf.length / TAXA).toFixed(2)}s  ${kb} KB`)
}

// --- os efeitos ---------------------------------------------------------------

/** Passagem de ar. Acompanha as transições e a varrida das dores na abertura. */
const whoosh = () => {
  const n = amostras(0.55)
  const buf = new Float32Array(n)
  const pb = criaPassaBaixa()
  const pa = criaPassaAlta()
  for (let i = 0; i < n; i++) {
    const t = i / n
    const ruido = Math.random() * 2 - 1
    // A banda sobe e desce: é isso que dá a sensação de algo PASSANDO, em vez
    // de um chiado com volume variando.
    const centro = varre(Math.sin(t * Math.PI), 400, 5200)
    const env = Math.sin(t * Math.PI) ** 1.6
    buf[i] = pb(pa(ruido, centro * 0.45), centro) * env
  }
  return finaliza(buf, 0.7)
}

/** A bola batendo na quadra: o pivô da abertura. */
const impacto = () => {
  const n = amostras(0.7)
  const buf = new Float32Array(n)
  const pb = criaPassaBaixa()
  let fase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    // Corpo: seno grave caindo de 140 para 48 Hz — o "tum".
    const f = varre(t, 140, 48)
    fase += (2 * Math.PI * f) / TAXA
    const corpo = Math.sin(fase) * Math.exp(-t * 7)
    // Estalo: ruído curtíssimo na frente, que é o couro tocando a areia.
    const estalo = pb(Math.random() * 2 - 1, 2600) * Math.exp(-t * 60) * 0.6
    buf[i] = corpo + estalo
  }
  return finaliza(buf, 0.9)
}

/** Toque de interface, para pontuar uma parada ou um destaque entrando. */
const clique = () => {
  const n = amostras(0.09)
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const env = Math.exp(-t * 45)
    buf[i] =
      (Math.sin((2 * Math.PI * 1850 * i) / TAXA) * 0.6 +
        Math.sin((2 * Math.PI * 2740 * i) / TAXA) * 0.3 +
        (Math.random() * 2 - 1) * 0.1) *
      env
  }
  return finaliza(buf, 0.55)
}

/** Tensão subindo antes de uma virada — usar com parcimônia, cansa rápido. */
const riser = () => {
  const n = amostras(1.6)
  const buf = new Float32Array(n)
  const pb = criaPassaBaixa()
  let fase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = varre(t, 180, 1400)
    fase += (2 * Math.PI * f) / TAXA
    const tom = Math.sin(fase) * 0.35
    const ar = pb(Math.random() * 2 - 1, varre(t, 700, 9000)) * 0.65
    buf[i] = (tom + ar) * Math.pow(t, 1.5)
  }
  return finaliza(buf, 0.6)
}

/** Grave que desce e assenta. Bom no corte para o encerramento. */
const subDrop = () => {
  const n = amostras(0.9)
  const buf = new Float32Array(n)
  let fase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = varre(t, 95, 32)
    fase += (2 * Math.PI * f) / TAXA
    buf[i] = Math.sin(fase) * Math.exp(-t * 2.6)
  }
  return finaliza(buf, 0.8)
}

// --- execução -----------------------------------------------------------------

mkdirSync(DESTINO, { recursive: true })
console.log(`Gerando efeitos em public/audio/sfx/ (${TAXA} Hz, mono, 16 bits):\n`)
escreveWav('whoosh.wav', whoosh())
escreveWav('impacto.wav', impacto())
escreveWav('clique.wav', clique())
escreveWav('riser.wav', riser())
escreveWav('sub-drop.wav', subDrop())
console.log('\nPronto. Ative os que quiser em EFEITOS, no src/config.ts.')
