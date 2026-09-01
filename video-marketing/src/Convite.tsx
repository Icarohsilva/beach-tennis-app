import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { Abertura, DUR_ABERTURA_FRAMES, escalaDoQuadro } from './Abertura'
import { DUR_GALERIA, Galeria } from './Galeria'
import { Brilho, Quadra } from './componentes/Quadra'
import { FaixasDeAudio, JanelaFala, TRANSICAO } from './Demo'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import { CONVITE, CONTATO } from './config'
import type { Faixa } from './config'

export const DUR_CHAMADA = 240

/**
 * O último bloco do Convite.
 *
 * Ele não pede a venda nem manda "responder": é uma frase que fecha a ideia e se
 * sustenta sozinha, porque este vídeo também vai para o story e para o feed, onde
 * "me responde" não faz sentido nenhum. O convite para conversar mora na mensagem
 * de WhatsApp que acompanha o arquivo, não dentro dele.
 */
const Chamada: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)

  const l1 = spring({ frame, fps, config: { damping: 14, mass: 0.7 } })
  const l2 = spring({ frame: frame - 14, fps, config: { damping: 14, mass: 0.7 } })
  const marca = spring({ frame: frame - 40, fps, config: { damping: 15, mass: 0.7 } })
  const apoio = interpolate(frame, [66, 88], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const risco = interpolate(frame, [22, 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra atraso={-60} />
      <Brilho atraso={0} />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: `0 ${70 * escala}px`,
        }}
      >
        <h2
          style={{
            fontFamily: SORA,
            fontSize: 96 * escala,
            fontWeight: 700,
            color: cores.texto,
            letterSpacing: -2.5,
            lineHeight: 1.08,
            margin: 0,
            transform: `translateY(${(1 - l1) * 44 * escala}px)`,
            opacity: l1,
          }}
        >
          {CONVITE.fecho.linha1}
        </h2>

        <h2
          style={{
            fontFamily: SORA,
            fontSize: 96 * escala,
            fontWeight: 700,
            color: cores.marca,
            letterSpacing: -2.5,
            lineHeight: 1.08,
            margin: `${12 * escala}px 0 0`,
            transform: `translateY(${(1 - l2) * 44 * escala}px)`,
            opacity: l2,
          }}
        >
          {CONVITE.fecho.linha2}
        </h2>

        <div
          style={{
            width: 420 * escala * risco,
            height: 5 * escala,
            borderRadius: 4,
            marginTop: 40 * escala,
            background: `linear-gradient(90deg, ${cores.marcaProfunda}, ${cores.marca}, #fdba74)`,
            boxShadow: `0 0 24px ${cores.marca}80`,
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16 * escala,
            marginTop: 62 * escala,
            opacity: marca,
            transform: `scale(${0.9 + marca * 0.1})`,
          }}
        >
          <Img
            src={staticFile('brand/arenahub-symbol-transparent.png')}
            style={{ width: 72 * escala, height: 72 * escala }}
          />
          <span
            style={{
              fontFamily: SORA,
              fontSize: 64 * escala,
              fontWeight: 700,
              color: cores.texto,
              letterSpacing: -1.6,
            }}
          >
            Arena<span style={{ color: cores.marca }}>Hub</span>
          </span>
        </div>

        <div
          style={{
            marginTop: 26 * escala,
            fontSize: 32 * escala,
            color: cores.textoSuave,
            opacity: apoio,
          }}
        >
          {CONVITE.fecho.apoio}
        </div>

        <div
          style={{
            marginTop: 14 * escala,
            fontSize: 34 * escala,
            fontWeight: 600,
            color: cores.marca,
            opacity: apoio,
          }}
        >
          {CONTATO.site}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export type ConviteProps = {
  faixas: Faixa[]
  trilha: Faixa[]
  efeitos: Faixa[]
  janelasFala: JanelaFala[]
}

export const DUR_CONVITE =
  DUR_ABERTURA_FRAMES + DUR_GALERIA + DUR_CHAMADA - 2 * TRANSICAO

/**
 * O vídeo curto que acompanha o "oi" no WhatsApp.
 *
 * Diferente da Apresentação em três coisas, todas por causa do contexto frio: é
 * vertical (o WhatsApp é vertical e mudo), mostra TELAS PARADAS em vez da
 * gravação (em 40 s, vídeo acelerado não dá tempo de ser entendido), e fecha com
 * uma frase que se sustenta sozinha, porque ele também serve para postar.
 */
export const Convite: React.FC<ConviteProps> = ({ faixas, trilha, efeitos, janelasFala }) => (
  <AbsoluteFill style={{ backgroundColor: cores.fundo }}>
    <FaixasDeAudio faixas={faixas} trilha={trilha} efeitos={efeitos} janelasFala={janelasFala} />

    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={DUR_ABERTURA_FRAMES}>
        <Abertura />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSICAO })}
      />
      <TransitionSeries.Sequence durationInFrames={DUR_GALERIA}>
        <Galeria />
      </TransitionSeries.Sequence>

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
