import type { Clipe } from './config'

/**
 * Teto de velocidade para tocar o arquivo BRUTO direto.
 *
 * O `playbackRate` de um elemento de vídeo do navegador para em 16×; acima
 * disso ele levanta `NotSupportedError` e o Studio não abre. Por isso a
 * aceleração de verdade acontece ANTES, em `npm run acelerar` — este teto só
 * vale para o caso degradado, quando o arquivo acelerado ainda não foi gerado.
 */
export const VELOCIDADE_MAX = 16

/** Sufixo do arquivo pré-acelerado: admin.mp4 + 20× → admin--20x.mp4 */
export const nomeAcelerado = (arquivo: string, velocidade: number) => {
  const ponto = arquivo.lastIndexOf('.')
  const base = ponto === -1 ? arquivo : arquivo.slice(0, ponto)
  const ext = ponto === -1 ? '.mp4' : arquivo.slice(ponto)
  return `${base}--${Math.round(velocidade)}x${ext}`
}

/**
 * Qual arquivo o vídeo deve tocar, e a que taxa.
 *
 * O caminho normal é o arquivo pré-acelerado, tocado a 1×: sem teto de taxa, sem
 * busca em arquivo de 20 min, e o Studio abre instantâneo. Quando ele ainda não
 * existe, cai no bruto com a taxa limitada a 16× — o vídeo sai mais longo do que
 * o pedido, mas visível, e o console diz o que rodar.
 */
export const resolverFonte = (clipe: Clipe, temAcelerado: boolean) => {
  const velocidade = Math.max(1, clipe.velocidade)
  if (velocidade <= 1) return { arquivo: clipe.arquivo, taxa: 1, acelerado: false }
  if (temAcelerado) {
    return { arquivo: nomeAcelerado(clipe.arquivo, velocidade), taxa: 1, acelerado: true }
  }
  return { arquivo: clipe.arquivo, taxa: Math.min(VELOCIDADE_MAX, velocidade), acelerado: false }
}

/**
 * Quantos frames o bloco ocupa.
 *
 * `duracaoFonte` é a duração do arquivo que vai TOCAR (já acelerado, ou o bruto)
 * e `taxa` é o que ainda falta acelerar na hora de tocar. Os dois juntos, e não a
 * velocidade pedida no config, porque no caso degradado eles divergem — e a
 * montagem precisa reservar o tempo que o vídeo vai realmente ocupar.
 */
export const framesDoClipe = (duracaoFonte: number, taxa: number, fps: number) =>
  Math.max(1, Math.round((duracaoFonte / Math.max(1, taxa)) * fps))
