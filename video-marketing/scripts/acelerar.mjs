// -----------------------------------------------------------------------------
// Gera as cópias aceleradas das gravações em ../public/videos/.
//
//   npm run acelerar
//
// admin.mp4 + velocidade 20  ->  admin--20x.mp4  (20 min viram 1 min)
//
// POR QUE ANTES, E NÃO NA HORA DE TOCAR: o `playbackRate` de um elemento de
// vídeo do navegador para em 16× (`NotSupportedError`), e a saída de saltar
// quadro a quadro para passar disso faz o Studio buscar posição nova 30 vezes
// por segundo num arquivo de 20 min — a busca nunca termina e a tela fica preta.
// Com o arquivo já acelerado, o vídeo toca a 1×: qualquer velocidade funciona, o
// Studio abre instantâneo e o render fica mais rápido.
//
// COMO: `-itsscale` reescala os tempos na entrada (não é filtro — o ffmpeg do
// Remotion vem com quase todos os filtros desabilitados, `setpts` inclusive) e
// `-r 30` na saída descarta os quadros que sobram, para o arquivo não virar um
// 600 fps que o navegador teria de decodificar inteiro.
// -----------------------------------------------------------------------------
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const VIDEOS = join(AQUI, '..', '..', 'public', 'videos')
const CONFIG = join(AQUI, '..', 'src', 'config.ts')

/**
 * O CLI do Remotion, chamado pelo próprio Node.
 *
 * NÃO por `npx`: no Windows o executável é `npx.cmd`, e `execFileSync` não
 * resolve extensão — dá `spawnSync npx ENOENT`. Chamar o .js direto funciona nos
 * três sistemas, dispensa `shell: true` (que traria problema de aspas em caminho
 * com espaço) e ainda pula a resolução de pacote que o npx faz a cada chamada.
 */
const REMOTION_CLI = join(AQUI, '..', 'node_modules', '@remotion', 'cli', 'remotion-cli.js')

/**
 * Lê os pares (arquivo, velocidade) do config.
 *
 * Por regex, e não por import, porque o config é TypeScript e este script roda
 * em Node puro. É frágil de propósito: se o formato mudar, ele para e diz, em
 * vez de acelerar a coisa errada em silêncio.
 */
const lerClipes = () => {
  const fonte = readFileSync(CONFIG, 'utf8')
  const bloco = fonte.slice(fonte.indexOf('export const CLIPES'), fonte.indexOf('export type Faixa'))
  const arquivos = [...bloco.matchAll(/arquivo:\s*'([^']+)'/g)].map((m) => m[1])
  const velocidades = [...bloco.matchAll(/velocidade:\s*([\d.]+)/g)].map((m) => Number(m[1]))

  if (arquivos.length === 0 || arquivos.length !== velocidades.length) {
    throw new Error(
      `Não consegui ler os clipes de src/config.ts (${arquivos.length} arquivos, ` +
        `${velocidades.length} velocidades). Se o formato do config mudou, ajuste lerClipes().`,
    )
  }
  return arquivos.map((arquivo, i) => ({ arquivo, velocidade: velocidades[i] }))
}

const nomeAcelerado = (arquivo, velocidade) => {
  const ponto = arquivo.lastIndexOf('.')
  const base = ponto === -1 ? arquivo : arquivo.slice(0, ponto)
  const ext = ponto === -1 ? '.mp4' : arquivo.slice(ponto)
  return `${base}--${Math.round(velocidade)}x${ext}`
}

const mb = (caminho) => (statSync(caminho).size / 1024 / 1024).toFixed(1)

if (!existsSync(REMOTION_CLI)) {
  throw new Error(`Não achei ${REMOTION_CLI}. Rode "npm install" primeiro.`)
}

const clipes = lerClipes()
let feitos = 0

for (const { arquivo, velocidade } of clipes) {
  const entrada = join(VIDEOS, arquivo)
  if (!existsSync(entrada)) {
    console.log(`  pulando ${arquivo} — não está em public/videos/`)
    continue
  }
  if (velocidade <= 1) {
    console.log(`  pulando ${arquivo} — velocidade ${velocidade}×, não precisa acelerar`)
    continue
  }

  const saida = join(VIDEOS, nomeAcelerado(arquivo, velocidade))
  console.log(`  ${arquivo} → ${nomeAcelerado(arquivo, velocidade)} (${velocidade}×)…`)

  execFileSync(
    process.execPath,
    [
      REMOTION_CLI,
      'ffmpeg',
      '-y',
      '-itsscale',
      String(1 / velocidade),
      '-i',
      entrada,
      // Sem áudio: a narração entra por cima, e o som da gravação acelerada só
      // atrapalharia.
      '-an',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-crf',
      '23',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      saida,
    ],
    { cwd: join(AQUI, '..'), stdio: ['ignore', 'ignore', 'pipe'] },
  )

  console.log(`    pronto: ${mb(saida)} MB`)
  feitos++
}

console.log(
  feitos > 0
    ? `\n${feitos} arquivo(s) acelerado(s). Rode de novo sempre que mudar a velocidade no config.`
    : '\nNada a fazer.',
)
