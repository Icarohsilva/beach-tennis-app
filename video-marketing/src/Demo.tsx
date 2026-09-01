import React from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { wipe } from '@remotion/transitions/wipe'
import { Abertura, DUR_ABERTURA_FRAMES } from './Abertura'
import { Capitulo } from './Capitulo'
import { Clipe } from './Clipe'
import { Encerramento } from './Encerramento'
import { cores } from './theme'
import type { Clipe as ClipeConfig, Faixa } from './config'

export const DUR_ABERTURA = DUR_ABERTURA_FRAMES
export const DUR_CAPITULO = 90
export const DUR_ENCERRAMENTO = 165
export const TRANSICAO = 18

/** Medida de cada arquivo, apurada em calculateMetadata (ver Root.tsx). */
export type Medida = {
  /** Duração do bloco na montagem. */
  frames: number
  /** Gravação de celular (vertical) ou de desktop — decide a moldura. */
  retrato: boolean
  /** Arquivo que vai tocar: o pré-acelerado quando existe. Ver `fonte.ts`. */
  arquivo: string
  /** O que ainda falta acelerar na hora de tocar. 1 no caminho normal. */
  taxa: number
}

/** Trecho em que alguém está falando, em frames. Usado para abaixar a trilha. */
export type JanelaFala = { de: number; ate: number }

export type DemoProps = {
  clipes: ClipeConfig[]
  medidas: Medida[]
  /**
   * Narração, trilha e efeitos. Ficam vazias nos recortes (DemoAluno/DemoArena):
   * os tempos das faixas são medidos no vídeo COMPLETO, então num recorte elas
   * cairiam no lugar errado — e narração fora de hora é pior do que nenhuma.
   */
  faixas: Faixa[]
  trilha: Faixa[]
  efeitos: Faixa[]
  /** Onde a narração fala, para a trilha sair da frente. */
  janelasFala: JanelaFala[]
}

/**
 * Volume da trilha ao longo do tempo: cai enquanto a narração fala e volta
 * depois. Trilha em volume fixo ou come a voz ou fica inaudível — não existe um
 * número que sirva para os dois momentos.
 *
 * A rampa evita o degrau: a música baixando de repente chama mais atenção do que
 * a música alta.
 */
export const volumeComDucking =
  (base: number, janelas: JanelaFala[], atenuacao = 0.3, rampa = 12) =>
  (frame: number) => {
    let fator = 1
    for (const janela of janelas) {
      if (frame < janela.de - rampa || frame > janela.ate + rampa) continue
      const entrando = Math.min(1, Math.max(0, (frame - (janela.de - rampa)) / rampa))
      const saindo = Math.min(1, Math.max(0, (janela.ate + rampa - frame) / rampa))
      fator = Math.min(fator, 1 - Math.min(entrando, saindo) * (1 - atenuacao))
    }
    return base * fator
  }

/**
 * Quantos frames o vídeo inteiro tem. Fica aqui, e não no Root, porque a conta
 * depende da montagem da TransitionSeries: cada transição SOBREPÕE dois blocos,
 * então ela encurta o total em vez de somar.
 */
export const duracaoTotal = (medidas: Medida[]) => {
  const n = medidas.length
  const transicoes = 1 + 2 * n // abertura→cap, e por clipe: cap→vídeo e vídeo→próximo
  return (
    DUR_ABERTURA +
    n * DUR_CAPITULO +
    medidas.reduce((soma, m) => soma + m.frames, 0) +
    DUR_ENCERRAMENTO -
    transicoes * TRANSICAO
  )
}

/** Narração e efeitos: volume fixo. Trilha: volume com ducking. */
export const FaixasDeAudio: React.FC<{
  faixas: Faixa[]
  trilha: Faixa[]
  efeitos: Faixa[]
  janelasFala: JanelaFala[]
}> = ({ faixas, trilha, efeitos, janelasFala }) => {
  const { fps } = useVideoConfig()

  const simples = [...faixas, ...efeitos]

  return (
    <>
      {simples.map((faixa) => (
        <Sequence key={`${faixa.arquivo}-${faixa.em}`} from={Math.round(faixa.em * fps)}>
          <Audio src={staticFile(`audio/${faixa.arquivo}`)} volume={faixa.volume} />
        </Sequence>
      ))}
      {trilha.map((faixa) => {
        const inicio = Math.round(faixa.em * fps)
        // As janelas são medidas na linha do tempo do vídeo; dentro da Sequence
        // o frame recomeça do zero, então desloca-se a janela, não o áudio.
        const janelas = janelasFala.map((j) => ({ de: j.de - inicio, ate: j.ate - inicio }))
        return (
          <Sequence key={`trilha-${faixa.arquivo}-${faixa.em}`} from={inicio}>
            <Audio
              src={staticFile(`audio/${faixa.arquivo}`)}
              volume={volumeComDucking(faixa.volume, janelas)}
            />
          </Sequence>
        )
      })}
    </>
  )
}

export const Demo: React.FC<DemoProps> = ({
  clipes,
  medidas,
  faixas,
  trilha,
  efeitos,
  janelasFala,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo }}>
      {/* Áudio fora da TransitionSeries de propósito: dentro dela cada faixa
          viraria um bloco da montagem e as transições comeriam 18 frames de
          narração em cada emenda. */}
      <FaixasDeAudio faixas={faixas} trilha={trilha} efeitos={efeitos} janelasFala={janelasFala} />

      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={DUR_ABERTURA}>
          <Abertura />
        </TransitionSeries.Sequence>

        {clipes.map((clipe, i) => {
          const medida =
            medidas[i] ?? { frames: 30 * 45, retrato: false, arquivo: clipe.arquivo, taxa: 1 }
          return (
            <React.Fragment key={clipe.arquivo}>
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSICAO })}
              />
              <TransitionSeries.Sequence durationInFrames={DUR_CAPITULO}>
                <Capitulo indice={clipe.indice} titulo={clipe.titulo} subtitulo={clipe.subtitulo} />
              </TransitionSeries.Sequence>

              <TransitionSeries.Transition
                presentation={wipe({ direction: 'from-right' })}
                timing={linearTiming({ durationInFrames: TRANSICAO })}
              />
              <TransitionSeries.Sequence durationInFrames={medida.frames}>
                <Clipe
                  clipe={clipe}
                  retrato={medida.retrato}
                  arquivo={medida.arquivo}
                  taxa={medida.taxa}
                />
              </TransitionSeries.Sequence>
            </React.Fragment>
          )
        })}

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSICAO })}
        />
        <TransitionSeries.Sequence durationInFrames={DUR_ENCERRAMENTO}>
          <Encerramento />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  )
}
