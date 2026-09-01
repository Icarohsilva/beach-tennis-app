import type { Clipe } from './config'

/**
 * Um pedaço da linha do tempo interna de um clipe: ou vídeo andando, ou uma
 * imagem congelada com rótulo.
 *
 * `trimBefore` é sempre em frames do ARQUIVO DE ORIGEM (na taxa do projeto), que
 * é o que o OffthreadVideo espera.
 */
export type Segmento =
  | { tipo: 'movimento'; frames: number; trimBefore: number }
  | { tipo: 'parada'; frames: number; trimBefore: number; texto: string }

/**
 * Fatia o clipe em trechos que andam e trechos congelados.
 *
 * Esta função é a ÚNICA fonte da matemática das paradas, e é chamada nos dois
 * lados: em `Root.tsx` para saber quantos frames o clipe ocupa na montagem, e em
 * `Clipe.tsx` para desenhar. Se as duas contas divergissem, o bloco terminaria
 * antes ou depois do que a linha do tempo reservou — vídeo cortado no meio ou
 * congelado no fim, sem erro nenhum aparecendo.
 *
 * `framesDeMovimento` é a duração do clipe SEM as paradas, ou seja
 * (bruto - cortes) / velocidade. As paradas somam por cima disso.
 */
export const montarSegmentos = (
  clipe: Clipe,
  framesDeMovimento: number,
  fps: number,
): Segmento[] => {
  const inicioNaOrigem = clipe.cortarInicio * fps
  const velocidade = Math.max(1, clipe.velocidade)

  // Frame da origem correspondente ao frame `k` da parte que anda.
  const origemEm = (k: number) => Math.round(inicioNaOrigem + k * velocidade)

  const paradas = [...clipe.paradas]
    .map((p) => ({ ...p, alvo: Math.round(p.em * fps) }))
    // Parada fora do clipe congelaria o último frame para sempre; descartar é
    // melhor do que desenhar uma imagem parada que ninguém pediu.
    .filter((p) => p.alvo > 0 && p.alvo < framesDeMovimento)
    .sort((a, b) => a.alvo - b.alvo)

  const segmentos: Segmento[] = []
  let cursor = 0

  for (const parada of paradas) {
    // Duas paradas no mesmo frame: a segunda vira só mais tempo parado, sem um
    // trecho de movimento de zero frame no meio (que a Series recusa).
    if (parada.alvo > cursor) {
      segmentos.push({
        tipo: 'movimento',
        frames: parada.alvo - cursor,
        trimBefore: origemEm(cursor),
      })
      cursor = parada.alvo
    }
    segmentos.push({
      tipo: 'parada',
      frames: Math.max(1, Math.round(parada.duracao * fps)),
      trimBefore: origemEm(parada.alvo),
      texto: parada.texto,
    })
  }

  if (cursor < framesDeMovimento) {
    segmentos.push({
      tipo: 'movimento',
      frames: framesDeMovimento - cursor,
      trimBefore: origemEm(cursor),
    })
  }

  return segmentos
}

export const duracaoDosSegmentos = (segmentos: Segmento[]) =>
  segmentos.reduce((soma, s) => soma + s.frames, 0)

/**
 * Qual parada está no ar num dado frame do clipe, e há quanto tempo.
 *
 * Existe para o rótulo poder ser desenhado FORA da moldura do vídeo: em quadro
 * vertical com gravação de desktop sobra metade da tela, e um rótulo preso à
 * moldura ficaria pequeno no meio de um vazio. Lendo a mesma lista de segmentos
 * que a `Series` consome, os dois nunca saem de sincronia.
 */
export const paradaNoFrame = (segmentos: Segmento[], frame: number) => {
  let inicio = 0
  for (const segmento of segmentos) {
    const fim = inicio + segmento.frames
    if (frame >= inicio && frame < fim) {
      return segmento.tipo === 'parada'
        ? { texto: segmento.texto, local: frame - inicio, frames: segmento.frames }
        : null
    }
    inicio = fim
  }
  return null
}
