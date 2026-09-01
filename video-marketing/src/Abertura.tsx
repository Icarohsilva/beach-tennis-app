import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Brilho, Quadra } from './componentes/Quadra'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import { APRESENTACAO, DORES } from './config'

/** Frame em que a bola bate e a marca "acende". */
const IMPACTO = 52

/** Frame em que o Ato 1 sai e o Ato 2 (as dores) entra. */
const ATO2 = 200

export const DUR_ABERTURA_FRAMES = 420

/**
 * Escala geral. Em retrato o quadro é bem mais estreito, então dividir pela
 * largura de paisagem deixaria tudo minúsculo; 1250 é a largura de projeto que
 * faz a marca nominal caber em 1080 com margem.
 */
export const escalaDoQuadro = (width: number, height: number) =>
  height > width ? width / 1250 : width / 1920

/** Escala do texto corrido, maior em retrato — lá o texto É o vídeo. */
const escalaDoTexto = (width: number, height: number) =>
  height > width ? width / 980 : width / 1920

const Bola: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame > IMPACTO + 6) return null

  // Queda com aceleração: y sai de -880 e chega a 0 em t², como gravidade.
  const p = interpolate(frame, [4, IMPACTO], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(p * p, [0, 1], [-880, 0])
  const x = interpolate(p, [0, 1], [-180, 0])
  const esmaga = frame >= IMPACTO - 2 ? interpolate(frame, [IMPACTO - 2, IMPACTO + 6], [1, 0]) : 0

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
        transform: `translate(${x}px, ${y}px) rotate(${p * 420}deg) scale(${1 + esmaga * 0.35}, ${1 - esmaga * 0.3})`,
        opacity: interpolate(frame, [2, 8], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    />
  )
}

const Onda: React.FC = () => {
  const frame = useCurrentFrame()
  const t = frame - IMPACTO
  if (t < 0 || t > 30) return null
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
        transform: `scale(${interpolate(t, [0, 30], [0.1, 2.0], { easing: (x) => 1 - Math.pow(1 - x, 3) })})`,
        opacity: interpolate(t, [0, 30], [0.7, 0]),
      }}
    />
  )
}

/**
 * ATO 1 — a apresentação.
 *
 * A marca já está na tela no frame 0, e não entra com o impacto. É de propósito:
 * o WhatsApp usa o primeiro quadro do vídeo como capa da mensagem, e é o único
 * que o contato vê garantidamente antes de decidir tocar — capa preta, ou com
 * meia frase, é a diferença entre abrir e passar direto. A bola não revela a
 * marca, ela ACENDE: o brilho, o risco e o pop de escala nascem do impacto.
 */
const Apresentacao: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)

  const aceso = spring({ frame: frame - IMPACTO, fps, config: { damping: 14, mass: 0.6 } })
  const sublinhado = interpolate(frame, [IMPACTO + 10, IMPACTO + 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })
  const descricao = spring({ frame: frame - IMPACTO - 30, fps, config: { damping: 16, mass: 0.8 } })

  const saida = interpolate(frame, [ATO2 - 22, ATO2 - 2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        transform: `scale(${escala}) translateY(${-saida * 70}px)`,
        opacity: 1 - saida,
      }}
    >
      <div
        style={{
          fontSize: 40,
          color: cores.textoSuave,
          letterSpacing: 1,
          marginBottom: 26,
          opacity: 0.75 + aceso * 0.25,
        }}
      >
        {APRESENTACAO.convite}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Img
          src={staticFile('brand/arenahub-symbol-transparent.png')}
          style={{
            width: 128,
            height: 128,
            transform: `scale(${0.94 + aceso * 0.06})`,
            filter: `drop-shadow(0 0 ${aceso * 46}px ${cores.marca}80)`,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', transform: `scale(${0.96 + aceso * 0.04})`, transformOrigin: 'left center' }}>
            {'ArenaHub'.split('').map((letra, i) => (
              <span
                key={i}
                style={{
                  fontFamily: SORA,
                  fontSize: 132,
                  fontWeight: 700,
                  letterSpacing: -4,
                  // "Arena" branco, "Hub" laranja — igual à nav da landing.
                  color: i < 5 ? cores.texto : cores.marca,
                  display: 'inline-block',
                }}
              >
                {letra}
              </span>
            ))}
          </div>
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
          marginTop: 42,
          fontSize: 40,
          lineHeight: 1.4,
          color: cores.textoSuave,
          textAlign: 'center',
          maxWidth: 1250,
          opacity: descricao,
          transform: `translateY(${(1 - descricao) * 26}px)`,
        }}
      >
        {APRESENTACAO.descricao}
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 44, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 1400 }}>
        {APRESENTACAO.pilares.map((pilar, i) => {
          const s = spring({ frame: frame - IMPACTO - 46 - i * 5, fps, config: { damping: 14, mass: 0.6 } })
          return (
            <div
              key={pilar}
              style={{
                padding: '16px 32px',
                borderRadius: 999,
                border: `1px solid ${cores.borda}`,
                background: `${cores.fundoCard}cc`,
                color: cores.texto,
                fontSize: 30,
                fontWeight: 500,
                transform: `translateY(${(1 - s) * 30}px) scale(${0.88 + s * 0.12})`,
                opacity: s,
              }}
            >
              {pilar}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/**
 * ATO 2 — as dores, em tópicos.
 *
 * Vem depois da apresentação, e não antes: o contato já sabe do que se trata
 * quando as frases aparecem, então elas soam como diagnóstico e não como
 * reclamação genérica. É também a parte que precisa funcionar SEM SOM, que é
 * como o WhatsApp toca vídeo por padrão — por isso tópico curto, não parágrafo.
 */
const DoresEmTopicos: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const t = frame - ATO2
  const escala = escalaDoTexto(width, height)
  const retrato = height > width

  if (t < -24) return null

  const titulo = spring({ frame: t, fps, config: { damping: 16, mass: 0.7 } })
  const fecho = spring({ frame: t - 150, fps, config: { damping: 13, mass: 0.7 } })
  const saida = interpolate(frame, [DUR_ABERTURA_FRAMES - 24, DUR_ABERTURA_FRAMES - 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: `0 ${(retrato ? 70 : 140) * escala}px`,
        opacity: (1 - saida) * Math.min(1, Math.max(0, (t + 24) / 24)),
        transform: `translateY(${-saida * 50 * escala}px)`,
      }}
    >
      <div style={{ width: '100%', maxWidth: 1500 * escala }}>
        <div
          style={{
            fontFamily: SORA,
            fontSize: 66 * escala,
            fontWeight: 700,
            color: cores.texto,
            letterSpacing: -1.5,
            marginBottom: 48 * escala,
            opacity: titulo,
            transform: `translateY(${(1 - titulo) * 34 * escala}px)`,
          }}
        >
          {DORES.titulo}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 * escala }}>
          {DORES.itens.map((item, i) => {
            const s = spring({ frame: t - 22 - i * 20, fps, config: { damping: 16, mass: 0.75 } })
            return (
              <div
                key={item}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 26 * escala,
                  opacity: s,
                  transform: `translateX(${(1 - s) * -44 * escala}px)`,
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 52 * escala,
                    height: 52 * escala,
                    borderRadius: 14 * escala,
                    background: `${cores.marca}1f`,
                    border: `1px solid ${cores.marca}55`,
                    color: cores.marca,
                    fontSize: 30 * escala,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // Gira até assentar: o tópico "cai no lugar" em vez de piscar.
                    transform: `rotate(${(1 - s) * -25}deg)`,
                  }}
                >
                  ✕
                </div>
                <span
                  style={{
                    fontFamily: SORA,
                    fontSize: 48 * escala,
                    fontWeight: 600,
                    color: cores.texto,
                    lineHeight: 1.25,
                    letterSpacing: -0.8,
                  }}
                >
                  {item}
                </span>
              </div>
            )
          })}
        </div>

        <div
          style={{
            marginTop: 56 * escala,
            fontFamily: SORA,
            fontSize: 58 * escala,
            fontWeight: 700,
            color: cores.marca,
            letterSpacing: -1.2,
            opacity: fecho,
            transform: `translateY(${(1 - fecho) * 30 * escala}px)`,
          }}
        >
          {DORES.fecho}
        </div>
      </div>
    </AbsoluteFill>
  )
}

export const Abertura: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
    <Quadra />
    <Brilho atraso={IMPACTO - 20} />

    <Apresentacao />
    <Bola />
    <Onda />
    <DoresEmTopicos />

    {/* Vinheta: fecha os cantos e joga o olho para o centro. */}
    <AbsoluteFill
      style={{ background: `radial-gradient(circle at 50% 50%, transparent 45%, ${cores.fundo}cc 100%)` }}
    />
  </AbsoluteFill>
)
