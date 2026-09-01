import React from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { wipe } from '@remotion/transitions/wipe'
import { Abertura } from './Abertura'
import { Capitulo } from './Capitulo'
import { Clipe } from './Clipe'
import { Encerramento } from './Encerramento'
import { cores } from './theme'
import type { Clipe as ClipeConfig, Faixa } from './config'

export const DUR_ABERTURA = 195
export const DUR_CAPITULO = 90
export const DUR_ENCERRAMENTO = 165
export const TRANSICAO = 18

/** Medida de cada arquivo, apurada em calculateMetadata (ver Root.tsx). */
export type Medida = { frames: number; retrato: boolean }

export type DemoProps = {
  clipes: ClipeConfig[]
  medidas: Medida[]
  /**
   * Narração e trilha. Fica vazia nos recortes (DemoAluno/DemoArena): os tempos
   * das faixas são medidos no vídeo COMPLETO, então num recorte elas cairiam no
   * lugar errado — e narração fora de hora é pior do que nenhuma.
   */
  faixas: Faixa[]
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

export const Demo: React.FC<DemoProps> = ({ clipes, medidas, faixas }) => {
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo }}>
      {/* Áudio fora da TransitionSeries de propósito: dentro dela cada faixa
          viraria um bloco da montagem e as transições comeriam 18 frames de
          narração em cada emenda. */}
      {faixas.map((faixa) => (
        <Sequence key={`${faixa.arquivo}-${faixa.em}`} from={Math.round(faixa.em * fps)}>
          <Audio src={staticFile(`audio/${faixa.arquivo}`)} volume={faixa.volume} />
        </Sequence>
      ))}

      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={DUR_ABERTURA}>
          <Abertura />
        </TransitionSeries.Sequence>

        {clipes.map((clipe, i) => {
          const medida = medidas[i] ?? { frames: 30 * 45, retrato: true }
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
                <Clipe clipe={clipe} retrato={medida.retrato} />
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
