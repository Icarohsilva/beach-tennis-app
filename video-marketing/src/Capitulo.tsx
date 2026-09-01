import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Quadra } from './componentes/Quadra'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'

/**
 * Cartão de capítulo entre a abertura e cada gravação. Existe por um motivo
 * comercial, não estético: o cliente precisa saber DE QUEM é a tela que ele vai
 * ver — a do aluno dele ou a dele mesmo — antes de a tela aparecer.
 */
export const Capitulo: React.FC<{ indice: string; titulo: string; subtitulo: string }> = ({
  indice,
  titulo,
  subtitulo,
}) => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const escala = width / 1920

  const ent = spring({ frame, fps, config: { damping: 14, mass: 0.6 } })
  const entSub = spring({ frame: frame - 10, fps, config: { damping: 14, mass: 0.6 } })
  const barra = interpolate(frame, [6, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })
  const saida = interpolate(frame, [66, 84], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra atraso={-40} />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          padding: `0 ${140 * escala}px`,
          transform: `scale(${escala}) translateX(${-saida * 80}px)`,
          transformOrigin: 'center',
          opacity: 1 - saida,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 26, opacity: ent }}>
          <span style={{ fontFamily: SORA, fontSize: 42, fontWeight: 700, color: cores.marca }}>
            {indice}
          </span>
          <div style={{ width: 280 * barra, height: 3, background: cores.marca, opacity: 0.7 }} />
        </div>

        <h1
          style={{
            fontFamily: SORA,
            fontSize: 96,
            fontWeight: 700,
            color: cores.texto,
            letterSpacing: -2,
            margin: '22px 0 0',
            maxWidth: 1400,
            lineHeight: 1.08,
            transform: `translateY(${(1 - ent) * 50}px)`,
            opacity: ent,
          }}
        >
          {titulo}
        </h1>

        <p
          style={{
            fontSize: 40,
            color: cores.textoSuave,
            maxWidth: 1200,
            lineHeight: 1.45,
            marginTop: 28,
            transform: `translateY(${(1 - entSub) * 40}px)`,
            opacity: entSub,
          }}
        >
          {subtitulo}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
