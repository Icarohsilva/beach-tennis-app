import React from 'react'
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { SORA, INTER } from './componentes/tipografia'
import { cores } from './theme'
import type { Clipe as ClipeConfig } from './config'

/**
 * Coluna de texto ao lado do celular. Ela é o motivo de a gravação vertical
 * caber num vídeo 16:9 sem parecer erro de enquadramento: o que sobra de quadro
 * vira argumento, e o cliente lê os pontos enquanto assiste ao fluxo.
 */
const PainelLateral: React.FC<{ clipe: ClipeConfig; escala: number }> = ({ clipe, escala }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        paddingLeft: 110 * escala,
        paddingRight: 40 * escala,
        width: '46%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 * escala, marginBottom: 34 * escala }}>
        <Img
          src={staticFile('brand/arenahub-symbol-transparent.png')}
          style={{ width: 46 * escala, height: 46 * escala }}
        />
        <span
          style={{
            fontFamily: SORA,
            fontWeight: 700,
            fontSize: 34 * escala,
            color: cores.texto,
            letterSpacing: -0.5,
          }}
        >
          Arena<span style={{ color: cores.marca }}>Hub</span>
        </span>
      </div>

      <h2
        style={{
          fontFamily: SORA,
          fontSize: 62 * escala,
          fontWeight: 700,
          color: cores.texto,
          letterSpacing: -1.5,
          lineHeight: 1.1,
          margin: 0,
        }}
      >
        {clipe.titulo}
      </h2>

      <div style={{ marginTop: 40 * escala, display: 'flex', flexDirection: 'column', gap: 24 * escala }}>
        {clipe.destaques.map((item, i) => {
          // Entram um a um, já com o vídeo rodando: dá ritmo ao painel sem
          // roubar a atenção do fluxo na tela do celular.
          const ent = spring({
            frame: frame - 26 - i * 12,
            fps,
            config: { damping: 16, mass: 0.7 },
          })
          return (
            <div
              key={item}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 18 * escala,
                transform: `translateX(${(1 - ent) * -30}px)`,
                opacity: ent,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 32 * escala,
                  height: 32 * escala,
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${cores.marca}, ${cores.marcaEscura})`,
                  color: '#fff',
                  fontSize: 19 * escala,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 6 * escala,
                }}
              >
                ✓
              </div>
              <span style={{ fontSize: 32 * escala, color: cores.textoSuave, lineHeight: 1.4 }}>
                {item}
              </span>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/**
 * Uma gravação de tela dentro do vídeo, emoldurada com a marca.
 *
 * Duas molduras, escolhidas pela proporção do arquivo (`retrato`, medido em
 * calculateMetadata): gravação de celular entra num aparelho desenhado, com as
 * sobras laterais preenchidas pela marca; gravação de desktop entra numa janela
 * com barra de título. Esticar um vídeo 9:16 para 16:9 — ou deixar duas tarjas
 * pretas — é o que faz demonstração parecer amadora.
 */
export const Clipe: React.FC<{ clipe: ClipeConfig; retrato: boolean }> = ({ clipe, retrato }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const escala = width / 1920

  const entrada = spring({ frame, fps, config: { damping: 16, mass: 0.8 } })
  // Respiro final: a moldura recua um pouco antes de cortar para o próximo bloco.
  const saida = interpolate(frame, [durationInFrames - 18, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const alturaMoldura = height * (retrato ? 0.86 : 0.8)
  const larguraMoldura = retrato ? alturaMoldura * (9 / 16) : alturaMoldura * (16 / 9)

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      {/* Fundo de marca: gradiente + brilho lateral, para a sobra ao lado do
          celular não ser um vazio preto. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 20%, ${cores.marcaProfunda}33 0%, transparent 55%), linear-gradient(160deg, ${cores.fundoCard} 0%, ${cores.fundo} 55%)`,
        }}
      />

      {/* Marca d'água discreta, canto superior esquerdo. Em retrato ela sai:
          o painel lateral já carrega a marca, e as duas juntas brigam. */}
      <div
        style={{
          position: 'absolute',
          top: 48 * escala,
          left: 56 * escala,
          display: 'flex',
          alignItems: 'center',
          gap: 14 * escala,
          opacity: retrato ? 0 : 0.9,
        }}
      >
        <Img
          src={staticFile('brand/arenahub-symbol-transparent.png')}
          style={{ width: 44 * escala, height: 44 * escala }}
        />
        <span
          style={{
            fontFamily: SORA,
            fontWeight: 700,
            fontSize: 32 * escala,
            color: cores.texto,
            letterSpacing: -0.5,
          }}
        >
          Arena<span style={{ color: cores.marca }}>Hub</span>
        </span>
      </div>

      {retrato ? <PainelLateral clipe={clipe} escala={escala} /> : null}

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          // Gravação de celular em quadro 16:9 deixa 60% da tela vazia. Em vez de
          // esticar o vídeo (que distorce) ou centralizar (que desperdiça), o
          // aparelho vai para a direita e o painel ocupa a sobra com argumento
          // de venda. Em desktop não há sobra, então segue centralizado.
          alignItems: retrato ? 'flex-end' : 'center',
          paddingRight: retrato ? 150 * escala : 0,
          transform: `scale(${0.94 + entrada * 0.06 - saida * 0.03})`,
          opacity: entrada,
        }}
      >
        <div
          style={{
            width: larguraMoldura,
            height: alturaMoldura,
            borderRadius: retrato ? 48 * escala : 20 * escala,
            border: `${(retrato ? 12 : 2) * escala}px solid ${retrato ? '#1b2537' : cores.borda}`,
            overflow: 'hidden',
            background: '#000',
            boxShadow: `0 ${40 * escala}px ${120 * escala}px rgba(0,0,0,0.65), 0 0 ${90 * escala}px ${cores.marca}22`,
            position: 'relative',
          }}
        >
          <OffthreadVideo
            src={staticFile(`videos/${clipe.arquivo}`)}
            trimBefore={Math.round(clipe.cortarInicio * fps)}
            playbackRate={clipe.velocidade}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            // A demonstração é narrada por você ao vivo / por legenda; o áudio
            // bruto de gravação de tela só atrapalha.
            muted
          />
        </div>
      </AbsoluteFill>

      {/* Selo de velocidade. Sem ele, uma gravação a 10x parece o app travando
          ou o vídeo com defeito — o cliente precisa ler que a pressa é edição. */}
      {clipe.velocidade > 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 48 * escala,
            right: 56 * escala,
            padding: `${10 * escala}px ${22 * escala}px`,
            borderRadius: 999,
            border: `1px solid ${cores.borda}`,
            background: `${cores.fundoCard}e6`,
            color: cores.textoSuave,
            fontSize: 26 * escala,
            fontWeight: 600,
            letterSpacing: 0.4,
            opacity: entrada,
          }}
        >
          <span style={{ color: cores.marca }}>▶</span> {clipe.velocidade}× · avanço rápido
        </div>
      ) : null}

      {/* Legendas (lower third) */}
      {clipe.legendas.map((leg, i) => {
        const inicio = Math.round(leg.em * fps)
        const fim = inicio + Math.round(leg.duracao * fps)
        if (frame < inicio || frame > fim) return null
        const ent = spring({ frame: frame - inicio, fps, config: { damping: 15, mass: 0.6 } })
        const sai = interpolate(frame, [fim - 8, fim], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 56 * escala,
              bottom: 64 * escala,
              maxWidth: width - 112 * escala,
              padding: `${18 * escala}px ${32 * escala}px`,
              borderRadius: 16 * escala,
              background: `${cores.fundoCard}f0`,
              borderLeft: `${5 * escala}px solid ${cores.marca}`,
              backdropFilter: 'blur(8px)',
              color: cores.texto,
              fontSize: 38 * escala,
              fontWeight: 500,
              lineHeight: 1.3,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              transform: `translateY(${(1 - ent) * 40 + sai * 30}px)`,
              opacity: ent * (1 - sai),
            }}
          >
            {leg.texto}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}
