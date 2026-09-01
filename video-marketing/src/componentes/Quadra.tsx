import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { cores, QUADRA } from '../theme'

/**
 * Quadra de beach tennis em perspectiva. É só CSS 3D: um plano deitado em
 * rotateX com linhas desenhadas por gradiente. Evita SVG animado (que pesa no
 * render frame a frame) e escala em qualquer resolução.
 *
 * `entrada` desloca a quadra no eixo Z ao longo da abertura — dá a sensação de
 * caminhar para dentro da quadra sem mexer na câmera.
 */
export const Quadra: React.FC<{ atraso?: number }> = ({ atraso = 0 }) => {
  const frame = useCurrentFrame()
  const t = Math.max(0, frame - atraso)

  const entrada = interpolate(t, [0, 90], [-420, 0], {
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })
  const opacidade = interpolate(t, [0, 35], [0, 1], { extrapolateRight: 'clamp' })
  // Deriva lenta e infinita: a quadra nunca fica parada atrás do texto.
  const deriva = (t * 0.35) % 160

  return (
    <AbsoluteFill style={{ overflow: 'hidden', perspective: 900 }}>
      <AbsoluteFill
        style={{
          opacity: opacidade,
          transform: `rotateX(74deg) translateZ(${entrada}px) translateY(${deriva}px)`,
          transformOrigin: '50% 100%',
          top: '34%',
          left: '-90%',
          width: '280%',
          height: '170%',
          backgroundImage: `
            repeating-linear-gradient(0deg,  ${QUADRA.linhaFraca} 0 2px, transparent 2px 160px),
            repeating-linear-gradient(90deg, ${QUADRA.linhaFraca} 0 2px, transparent 2px 160px)
          `,
        }}
      />
      {/* Linhas fortes: a marcação real da quadra (fundo, meio, laterais). */}
      <AbsoluteFill
        style={{
          opacity: opacidade * 0.9,
          transform: `rotateX(74deg) translateZ(${entrada}px)`,
          transformOrigin: '50% 100%',
          top: '34%',
          left: '-90%',
          width: '280%',
          height: '170%',
          backgroundImage: `
            linear-gradient(90deg, transparent 14%, ${QUADRA.linha} 14%, ${QUADRA.linha} calc(14% + 3px), transparent calc(14% + 3px)),
            linear-gradient(90deg, transparent 86%, ${QUADRA.linha} 86%, ${QUADRA.linha} calc(86% + 3px), transparent calc(86% + 3px)),
            linear-gradient(0deg,  transparent 50%, ${QUADRA.linha} 50%, ${QUADRA.linha} calc(50% + 3px), transparent calc(50% + 3px))
          `,
        }}
      />
      {/* Brasa no horizonte: separa a quadra do fundo sem acender a cena. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 26% at 50% 40%, ${cores.marcaProfunda}55 0%, transparent 70%)`,
          opacity: opacidade,
        }}
      />

      {/* Névoa: apaga o horizonte para o texto ter contraste em cima. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${cores.fundo} 0%, ${cores.fundo}e6 22%, ${cores.fundo}66 44%, transparent 68%, ${cores.fundo}55 100%)`,
        }}
      />
    </AbsoluteFill>
  )
}

/** Brilho laranja que pulsa atrás do logo. */
export const Brilho: React.FC<{ atraso?: number }> = ({ atraso = 0 }) => {
  const frame = useCurrentFrame()
  const t = Math.max(0, frame - atraso)
  const escala = interpolate(t, [0, 45], [0.2, 1], {
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 4),
  })
  const pulso = 1 + Math.sin(t / 22) * 0.04
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 46%, ${cores.marca}45 0%, ${cores.marcaProfunda}22 32%, transparent 62%)`,
        transform: `scale(${escala * pulso})`,
        opacity: interpolate(t, [0, 30], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    />
  )
}
