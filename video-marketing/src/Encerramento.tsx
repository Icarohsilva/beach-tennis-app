import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Quadra, Brilho } from './componentes/Quadra'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import { CONTATO } from './config'

/** Último quadro: é o que fica congelado na tela quando o vídeo acaba no WhatsApp. */
export const Encerramento: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const escala = width / 1920

  const logo = spring({ frame, fps, config: { damping: 13, mass: 0.7 } })
  const titulo = spring({ frame: frame - 12, fps, config: { damping: 14, mass: 0.7 } })
  const botao = spring({ frame: frame - 28, fps, config: { damping: 11, mass: 0.6 } })
  const rodape = interpolate(frame, [46, 68], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pulso = 1 + Math.sin(Math.max(0, frame - 40) / 14) * 0.018

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra atraso={-60} />
      <Brilho atraso={0} />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          transform: `scale(${escala})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: logo }}>
          <Img
            src={staticFile('brand/arenahub-symbol-transparent.png')}
            style={{ width: 84, height: 84, transform: `scale(${logo})` }}
          />
          <span style={{ fontFamily: SORA, fontSize: 76, fontWeight: 700, color: cores.texto, letterSpacing: -2 }}>
            Arena<span style={{ color: cores.marca }}>Hub</span>
          </span>
        </div>

        <h2
          style={{
            fontFamily: SORA,
            fontSize: 78,
            fontWeight: 700,
            color: cores.texto,
            letterSpacing: -2,
            lineHeight: 1.15,
            margin: '46px 0 0',
            maxWidth: 1300,
            transform: `translateY(${(1 - titulo) * 40}px)`,
            opacity: titulo,
          }}
        >
          Sua arena lotada começa <span style={{ color: cores.marca }}>hoje</span>.
        </h2>

        <div
          style={{
            marginTop: 52,
            padding: '26px 60px',
            borderRadius: 999,
            background: `linear-gradient(135deg, ${cores.marcaEscura}, ${cores.marcaProfunda})`,
            color: '#fff',
            fontSize: 40,
            fontWeight: 600,
            boxShadow: `0 24px 70px ${cores.marca}44`,
            transform: `scale(${(0.85 + botao * 0.15) * pulso})`,
            opacity: botao,
          }}
        >
          {CONTATO.chamada} →
        </div>

        <div style={{ marginTop: 30, fontSize: 28, color: cores.textoSuave, opacity: rodape }}>
          {CONTATO.reforco}
        </div>

        <div
          style={{
            marginTop: 62,
            display: 'flex',
            gap: 44,
            fontSize: 32,
            color: cores.texto,
            opacity: rodape,
          }}
        >
          <span>{CONTATO.site}</span>
          <span style={{ color: cores.borda }}>|</span>
          <span style={{ color: cores.marca }}>{CONTATO.instagram}</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
