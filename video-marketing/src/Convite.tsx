import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { Abertura, DUR_ABERTURA_FRAMES, escalaDoQuadro } from './Abertura'
import { Clipe } from './Clipe'
import { Brilho, Quadra } from './componentes/Quadra'
import { FaixasDeAudio, JanelaFala, Medida, TRANSICAO } from './Demo'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import { CONVITE, CONTATO } from './config'
import type { Clipe as ClipeConfig, Faixa } from './config'

export const DUR_CHAMADA = 210

/**
 * O último bloco do Convite. Ele pede UMA coisa: permissão para mandar o vídeo
 * completo. Pedir a venda aqui seria pedir demais para um primeiro contato — e
 * um "posso te mandar?" é um sim muito mais barato do que "vamos conversar?".
 */
const Chamada: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)

  const pergunta = spring({ frame, fps, config: { damping: 13, mass: 0.7 } })
  const resposta = spring({ frame: frame - 16, fps, config: { damping: 14, mass: 0.7 } })
  const marca = interpolate(frame, [40, 62], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pulso = 1 + Math.sin(Math.max(0, frame - 30) / 13) * 0.02

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra atraso={-60} />
      <Brilho atraso={0} />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: `0 ${90 * escala}px`,
        }}
      >
        <h2
          style={{
            fontFamily: SORA,
            fontSize: 104 * escala,
            fontWeight: 700,
            color: cores.texto,
            letterSpacing: -2.5,
            lineHeight: 1.1,
            margin: 0,
            transform: `translateY(${(1 - pergunta) * 50 * escala}px) scale(${(0.9 + pergunta * 0.1) * pulso})`,
            opacity: pergunta,
          }}
        >
          {CONVITE.pergunta}
        </h2>

        <p
          style={{
            fontSize: 46 * escala,
            color: cores.textoSuave,
            lineHeight: 1.4,
            marginTop: 34 * escala,
            maxWidth: 1100 * escala,
            transform: `translateY(${(1 - resposta) * 34 * escala}px)`,
            opacity: resposta,
          }}
        >
          {CONVITE.resposta}
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16 * escala,
            marginTop: 74 * escala,
            opacity: marca,
          }}
        >
          <Img
            src={staticFile('brand/arenahub-symbol-transparent.png')}
            style={{ width: 66 * escala, height: 66 * escala }}
          />
          <span
            style={{
              fontFamily: SORA,
              fontSize: 58 * escala,
              fontWeight: 700,
              color: cores.texto,
              letterSpacing: -1.5,
            }}
          >
            Arena<span style={{ color: cores.marca }}>Hub</span>
          </span>
        </div>

        <div style={{ marginTop: 22 * escala, fontSize: 32 * escala, color: cores.textoSuave, opacity: marca }}>
          {CONTATO.site}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export type ConviteProps = {
  /** Já com os trechos próprios do convite e aparados ao arquivo — ver Root.tsx. */
  clipes: ClipeConfig[]
  medidas: Medida[]
  faixas: Faixa[]
  trilha: Faixa[]
  efeitos: Faixa[]
  janelasFala: JanelaFala[]
}

export const duracaoConvite = (medidas: Medida[]) =>
  DUR_ABERTURA_FRAMES +
  medidas.reduce((soma, m) => soma + m.frames, 0) +
  DUR_CHAMADA -
  (medidas.length + 1) * TRANSICAO

/**
 * O vídeo curto que acompanha o "oi" no WhatsApp.
 *
 * Diferente do Demo em três coisas, todas por causa do contexto frio: é vertical
 * (o WhatsApp é vertical e mudo), não tem cartão de capítulo (não sobra tempo
 * para anunciar o que vem — a prova tem de entrar direto), e termina pedindo
 * permissão em vez de pedir a venda.
 */
export const Convite: React.FC<ConviteProps> = ({
  clipes,
  medidas,
  faixas,
  trilha,
  efeitos,
  janelasFala,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo }}>
      <FaixasDeAudio faixas={faixas} trilha={trilha} efeitos={efeitos} janelasFala={janelasFala} />

      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={DUR_ABERTURA_FRAMES}>
          <Abertura />
        </TransitionSeries.Sequence>

        {clipes.map((clipe, i) => {
          const medida = medidas[i]
          if (!medida) return null
          return (
            <React.Fragment key={clipe.arquivo}>
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSICAO })}
              />
              <TransitionSeries.Sequence durationInFrames={medida.frames}>
                <Clipe clipe={clipe} retrato={medida.retrato} comPainel={false} />
              </TransitionSeries.Sequence>
            </React.Fragment>
          )
        })}

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSICAO })}
        />
        <TransitionSeries.Sequence durationInFrames={DUR_CHAMADA}>
          <Chamada />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  )
}
