import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Brilho, Quadra } from './componentes/Quadra'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'

/** Frame em que a bola bate no chão — tudo na abertura nasce desse impacto. */
const IMPACTO = 44

/**
 * A bola cai, quica e o logo nasce do impacto. O motivo de a abertura ser
 * assim (e não um fade de logo) é que ela precisa dizer "isto é esporte de
 * areia" antes de dizer "isto é um software".
 */
const Bola: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame > IMPACTO + 6) return null

  // Queda com aceleração: y vai de -420 até 0 em t², como gravidade de verdade.
  const p = interpolate(frame, [6, IMPACTO], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(p * p, [0, 1], [-460, 0])
  const x = interpolate(p, [0, 1], [-260, 0])
  // Achatamento no toque: vende o peso da bola.
  const esmaga = frame >= IMPACTO - 2 ? interpolate(frame, [IMPACTO - 2, IMPACTO + 6], [1, 0]) : 0
  const rotacao = interpolate(p, [0, 1], [0, 420])

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '46%',
        width: 74,
        height: 74,
        marginLeft: -37,
        marginTop: -37,
        borderRadius: '50%',
        background: `radial-gradient(circle at 34% 30%, #fdba74, ${cores.marca} 55%, ${cores.marcaEscura})`,
        boxShadow: `0 0 60px ${cores.marca}90`,
        transform: `translate(${x}px, ${y}px) rotate(${rotacao}deg) scale(${1 + esmaga * 0.35}, ${1 - esmaga * 0.3})`,
        opacity: interpolate(frame, [4, 10], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    />
  )
}

/** Onda de choque do impacto. */
const Onda: React.FC = () => {
  const frame = useCurrentFrame()
  const t = frame - IMPACTO
  if (t < 0 || t > 30) return null
  const escala = interpolate(t, [0, 30], [0.1, 2.0], { easing: (x) => 1 - Math.pow(1 - x, 3) })
  const opacidade = interpolate(t, [0, 30], [0.7, 0])
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '46%',
        width: 340,
        height: 340,
        marginLeft: -170,
        marginTop: -170,
        borderRadius: '50%',
        border: `3px solid ${cores.marca}`,
        transform: `scale(${escala})`,
        opacity: opacidade,
      }}
    />
  )
}

export const Abertura: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const escalaBase = width / 1920 // deixa a abertura idêntica em 1080x1920

  const entradaLogo = spring({ frame: frame - IMPACTO, fps, config: { damping: 12, mass: 0.7 } })
  const palavras = 'ArenaHub'

  const sublinhado = interpolate(frame, [IMPACTO + 26, IMPACTO + 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })

  const chips = ['Aulas', 'Pagamentos', 'Check-in', 'Comunidade']

  // Saída: tudo sobe e some nos últimos 12 frames, entregando a transição.
  const saida = interpolate(frame, [166, 184], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra />
      <Brilho atraso={IMPACTO - 10} />
      <Bola />
      <Onda />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${escalaBase}) translateY(${-saida * 60}px)`,
          opacity: 1 - saida,
        }}
      >
        {/* Símbolo + marca nominal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Img
            src={staticFile('brand/arenahub-symbol-transparent.png')}
            style={{
              width: 128,
              height: 128,
              transform: `scale(${entradaLogo}) rotate(${(1 - entradaLogo) * -35}deg)`,
              filter: `drop-shadow(0 0 40px ${cores.marca}70)`,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex' }}>
              {palavras.split('').map((letra, i) => {
                const s = spring({
                  frame: frame - IMPACTO - 4 - i * 2.5,
                  fps,
                  config: { damping: 13, mass: 0.55 },
                })
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: SORA,
                      fontSize: 132,
                      fontWeight: 700,
                      letterSpacing: -4,
                      // "Arena" branco, "Hub" laranja — igual à nav da landing.
                      color: i < 5 ? cores.texto : cores.marca,
                      transform: `translateY(${(1 - s) * 70}px) scale(${0.7 + s * 0.3})`,
                      opacity: s,
                      display: 'inline-block',
                    }}
                  >
                    {letra}
                  </span>
                )
              })}
            </div>

            {/* Risco laranja que varre por baixo da marca. Fica DENTRO da coluna
                da marca nominal: centrado no quadro, ele nasceria deslocado,
                porque o símbolo empurra o grupo inteiro para a direita. */}
            <div style={{ height: 5, marginTop: 6, alignSelf: 'stretch' }}>
              <div
                style={{
                  width: `${sublinhado * 100}%`,
                  height: '100%',
                  borderRadius: 4,
                  background: `linear-gradient(90deg, ${cores.marcaProfunda}, ${cores.marca}, #fdba74)`,
                  boxShadow: `0 0 24px ${cores.marca}80`,
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 40,
            fontSize: 42,
            color: cores.textoSuave,
            letterSpacing: 0.5,
            textAlign: 'center',
            opacity: interpolate(frame, [IMPACTO + 44, IMPACTO + 66], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translateY(${interpolate(frame, [IMPACTO + 44, IMPACTO + 66], [24, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}px)`,
          }}
        >
          Gestão completa para a sua arena
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 46 }}>
          {chips.map((chip, i) => {
            const s = spring({
              frame: frame - IMPACTO - 58 - i * 5,
              fps,
              config: { damping: 14, mass: 0.6 },
            })
            return (
              <div
                key={chip}
                style={{
                  padding: '16px 32px',
                  borderRadius: 999,
                  border: `1px solid ${cores.borda}`,
                  background: `${cores.fundoCard}cc`,
                  color: cores.texto,
                  fontSize: 30,
                  fontWeight: 500,
                  backdropFilter: 'blur(6px)',
                  transform: `translateY(${(1 - s) * 34}px) scale(${0.86 + s * 0.14})`,
                  opacity: s,
                }}
              >
                {chip}
              </div>
            )
          })}
        </div>
      </AbsoluteFill>

      {/* Vinheta: fecha os cantos e joga o olho para o centro. */}
      <AbsoluteFill
        style={{ background: `radial-gradient(circle at 50% 50%, transparent 45%, ${cores.fundo}cc 100%)` }}
      />
    </AbsoluteFill>
  )
}
