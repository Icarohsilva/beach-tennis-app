import type { Clipe, Trecho } from './config'

/**
 * Teto de velocidade. O `playbackRate` de um elemento de vídeo do navegador vai
 * até 16× — acima disso ele levanta `NotSupportedError` e o Studio não abre.
 *
 * O corte mora aqui, e não no componente, porque a duração do bloco e a
 * reprodução TÊM de usar o mesmo número: cortando só na hora de tocar, o vídeo
 * acabaria antes do que a linha do tempo reservou e o resto ficaria congelado.
 */
export const VELOCIDADE_MAX = 16

/** Um pedaço já resolvido em frames, pronto para virar uma `Series.Sequence`. */
export type Segmento = {
  frames: number
  /** Frame do ARQUIVO DE ORIGEM em que começa (na taxa do projeto). */
  trimBefore: number
  velocidade: number
}

const velocidadeUtil = (t: Trecho) => Math.min(VELOCIDADE_MAX, Math.max(0.1, t.velocidade))

/**
 * Traduz os trechos escolhidos em segmentos de linha do tempo.
 *
 * Única fonte da matemática, chamada nos dois lados: em `Root.tsx` para saber
 * quantos frames o bloco ocupa na montagem, e em `Clipe.tsx` para desenhar. Se
 * as duas contas divergissem, o bloco terminaria fora do que a montagem
 * reservou — vídeo cortado no meio ou parado no fim, sem erro nenhum aparecendo.
 */
export const montarSegmentos = (clipe: Clipe, fps: number): Segmento[] =>
  clipe.trechos
    .filter((t) => t.ate > t.de)
    .map((t) => {
      const velocidade = velocidadeUtil(t)
      return {
        frames: Math.max(1, Math.round(((t.ate - t.de) / velocidade) * fps)),
        trimBefore: Math.round(t.de * fps),
        velocidade,
      }
    })

export const duracaoDosSegmentos = (segmentos: Segmento[]) =>
  segmentos.reduce((soma, s) => soma + s.frames, 0)

/**
 * Ajusta os trechos ao que a gravação realmente tem.
 *
 * Um `ate` além do fim do arquivo faz o vídeo congelar no último quadro pelo
 * tempo que sobrar, sem aviso — e como os valores padrão são chute até alguém
 * abrir a gravação, esse é o caso comum, não a exceção.
 */
export const ajustarAoArquivo = (clipe: Clipe, duracaoSegundos: number): Clipe => {
  const trechos = clipe.trechos
    .map((t) => ({ ...t, de: Math.min(t.de, duracaoSegundos), ate: Math.min(t.ate, duracaoSegundos) }))
    .filter((t) => t.ate - t.de >= 1)

  return {
    ...clipe,
    // Gravação mais curta do que todos os trechos pedidos: em vez de devolver um
    // bloco vazio (que quebraria a montagem), usa o que existe.
    trechos: trechos.length > 0 ? trechos : [{ de: 0, ate: duracaoSegundos, velocidade: 3 }],
  }
}

/** Velocidade mostrada no selo — a maior entre os trechos, arredondada. */
export const velocidadeVisivel = (clipe: Clipe) =>
  Math.round(Math.max(...clipe.trechos.map(velocidadeUtil), 1))
