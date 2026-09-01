import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Brilho, Quadra } from './componentes/Quadra'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import { DORES } from './config'

/**
 * Frame em que a bola bate no chão. É o pivô da abertura inteira: antes dele
 * são as dores, depois é a marca. A bola não é enfeite — é ela que varre as
 * dores da tela, e é por isso que o logo parece uma resposta e não um logo.
 */
const IMPACTO = 150

/**
 * Quando cada dor entra. A última fica na tela até o impacto levá-la.
 *
 * A primeira começa em NEGATIVO de propósito: no frame 0 ela já está quase toda
 * na tela. O WhatsApp usa o primeiro frame do vídeo como capa da mensagem, e uma
 * capa preta é a diferença entre o contato abrir e passar direto — é o único
 * quadro que ele vê garantidamente, antes de decidir tocar.
 */
const ENTRADA_DOR = [-14, 40, 84]

export const DUR_ABERTURA_FRAMES = 300

/**
 * Escala de tudo. Em retrato o quadro é bem mais estreito, então dividir pela
 * largura de paisagem deixaria o texto minúsculo; 1250 é a largura de projeto
 * que faz a marca nominal caber em 1080 com margem.
 */
export const escalaDoQuadro = (width: number, height: number) =>
  height > width ? width / 1250 : width / 1920

const Bola: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < 126 || frame > IMPACTO + 6) return null

  // Queda com aceleração: y sai de -460 e chega a 0 em t², como gravidade.
  const p = interpolate(frame, [128, IMPACTO], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(p * p, [0, 1], [-880, 0])
  const x = interpolate(p, [0, 1], [-200, 0])
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
        opacity: interpolate(frame, [126, 132], [0, 1], { extrapolateRight: 'clamp' }),
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

/**
 * Ato 1: as dores, antes de qualquer marca.
 *
 * Em vídeo de prospecção fria o espectador decide em ~5 s se continua assistindo,
 * e logo animado não é motivo para continuar — nomear o problema dele é. Por isso
 * a marca só aparece no Ato 2, depois que ele já se reconheceu na tela.
 *
 * O texto também é a única coisa aqui que precisa funcionar SEM SOM, que é como o
 * WhatsApp toca vídeo por padrão.
 */
const Dores: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  // As dores usam escala PRÓPRIA, maior que a do resto em quadro vertical. A
  // escala geral existe para a marca nominal caber em 1080 de largura; aplicada
  // ao texto do gancho, ela o deixaria ocupando 7% da tela num vídeo que vai ser
  // visto no celular, muitas vezes sem som. Aqui o texto É o vídeo.
  const escalaTexto = height > width ? width / 950 : width / 1920

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: `0 ${54 * escalaTexto}px`,
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 * escalaTexto, maxWidth: 1550 * escalaTexto }}>
        {DORES.map((dor, i) => {
          const entrada = spring({
            frame: frame - (ENTRADA_DOR[i] ?? i * 42),
            fps,
            config: { damping: 15, mass: 0.7 },
          })
          // A varrida: o impacto joga cada frase para fora, uma logo após a
          // outra. É o que amarra a bola ao texto — sem isso a bola seria só
          // uma animação bonita passando por cima de uma lista.
          const varrida = interpolate(frame, [IMPACTO + i * 3, IMPACTO + 14 + i * 3], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          // A frase que já foi dita recua um pouco: mantém o olho na mais nova.
          const veterana = i < DORES.length - 1 ? 0.55 : 1

          return (
            <div
              key={dor}
              style={{
                fontFamily: SORA,
                fontWeight: 700,
                fontSize: (i === 0 ? 100 : 74) * escalaTexto,
                letterSpacing: -1.5,
                lineHeight: 1.18,
                color: i === 0 ? cores.marca : cores.texto,
                opacity: entrada * (1 - varrida) * (i === 0 ? 1 : veterana + (1 - veterana) * 0.75),
                transform: `translateY(${(1 - entrada) * 46 * escalaTexto - varrida * 130 * escalaTexto}px) scale(${
                  (0.94 + entrada * 0.06) * (1 - varrida * 0.12)
                })`,
              }}
            >
              {dor}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

export const Abertura: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)

  const entradaLogo = spring({ frame: frame - IMPACTO, fps, config: { damping: 12, mass: 0.7 } })
  const palavras = 'ArenaHub'

  const sublinhado = interpolate(frame, [IMPACTO + 26, IMPACTO + 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - Math.pow(1 - x, 3),
  })

  const chips = ['Aulas', 'Pagamentos', 'Check-in', 'Comunidade']

  // Saída: tudo sobe e some no fim, entregando a transição.
  const saida = interpolate(frame, [DUR_ABERTURA_FRAMES - 28, DUR_ABERTURA_FRAMES - 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      <Quadra />
      <Brilho atraso={IMPACTO - 10} />

      {/* ATO 1 — as dores */}
      <Dores />

      <Bola />
      <Onda />

      {/* ATO 2 — a marca, nascida do impacto */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${escala}) translateY(${-saida * 60}px)`,
          opacity: 1 - saida,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Img
            src={staticFile('brand/arenahub-symbol-transparent.png')}
            style={{
              width: 128,
              height: 128,
              transform: `scale(${entradaLogo}) rotate(${(1 - entradaLogo) * -35}deg)`,
              filter: `drop-shadow(0 0 40px ${cores.marca}70)`,
              opacity: entradaLogo,
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

        <div
          style={{
            display: 'flex',
            gap: 18,
            marginTop: 46,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: 1500,
          }}
        >
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
