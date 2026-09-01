import React from 'react'
import { AbsoluteFill, Img, Series, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { SORA, INTER } from './componentes/tipografia'
import { escalaDoQuadro } from './Abertura'
import { cores } from './theme'
import { CONVITE } from './config'

/**
 * Uma tela do app, parada, dentro do celular desenhado — com o rótulo do que ela
 * é logo abaixo.
 *
 * O Convite mostra IMAGENS e não a gravação, e o motivo é de leitura: em 40 s de
 * vídeo frio, gravação acelerada vira borrão e o contato não entende nenhuma
 * tela. Um print parado, com uma frase, ele lê inteiro em três segundos. A
 * gravação continua sendo o corpo da Apresentação, onde há tempo para ela.
 */
const Tela: React.FC<{ arquivo: string; rotulo: string }> = ({ arquivo, rotulo }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)

  const ent = spring({ frame, fps, config: { damping: 18, mass: 0.8 } })
  const sai = interpolate(frame, [durationInFrames - 10, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const visivel = ent * (1 - sai)
  // Deriva lenta: uma imagem totalmente parada num vídeo parece congelamento.
  const deriva = interpolate(frame, [0, durationInFrames], [0, -18 * escala])

  const larguraTela = Math.min(width * 0.78, height * 0.62 * (9 / 16))
  const alturaTela = larguraTela / (9 / 16)

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ opacity: visivel, transform: `translateY(${deriva}px) scale(${0.96 + ent * 0.04})` }}>
        <div
          style={{
            width: larguraTela,
            height: alturaTela,
            borderRadius: 46 * escala,
            border: `${11 * escala}px solid #1b2537`,
            overflow: 'hidden',
            background: '#000',
            boxShadow: `0 ${34 * escala}px ${100 * escala}px rgba(0,0,0,0.6), 0 0 ${80 * escala}px ${cores.marca}22`,
          }}
        >
          <Img
            src={staticFile(`imagens/${arquivo}`)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
          />
        </div>

        <div
          style={{
            marginTop: 40 * escala,
            textAlign: 'center',
            fontFamily: SORA,
            fontWeight: 700,
            fontSize: 46 * escala,
            letterSpacing: -1,
            color: cores.texto,
            maxWidth: larguraTela + 120 * escala,
          }}
        >
          {rotulo}
        </div>
      </div>
    </AbsoluteFill>
  )
}

export const DUR_IMAGEM = Math.round(CONVITE.segundosPorImagem * 30)
export const DUR_GALERIA = DUR_IMAGEM * CONVITE.imagens.length

/** A sequência de telas do Convite, uma depois da outra. */
export const Galeria: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 22%, ${cores.marcaProfunda}3a 0%, transparent 58%), linear-gradient(160deg, ${cores.fundoCard} 0%, ${cores.fundo} 55%)`,
      }}
    />

    <MarcaDagua />

    <Series>
      {CONVITE.imagens.map((imagem) => (
        <Series.Sequence key={imagem.arquivo} durationInFrames={DUR_IMAGEM}>
          <Tela arquivo={imagem.arquivo} rotulo={imagem.rotulo} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
)

const MarcaDagua: React.FC = () => {
  const { width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)
  return (
    <div
      style={{
        position: 'absolute',
        top: 54 * escala,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 14 * escala,
        opacity: 0.9,
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
          fontSize: 34 * escala,
          color: cores.texto,
          letterSpacing: -0.5,
        }}
      >
        Arena<span style={{ color: cores.marca }}>Hub</span>
      </span>
    </div>
  )
}
