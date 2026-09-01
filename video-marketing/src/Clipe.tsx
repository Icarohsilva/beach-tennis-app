import React from 'react'
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { SORA, INTER } from './componentes/tipografia'
import { escalaDoQuadro } from './Abertura'
import { cores } from './theme'
import { montarSegmentos, paradaNoFrame } from './segmentos'
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

/** Escurece a imagem congelada. Fica dentro da moldura, colada ao vídeo. */
const EscurecerParada: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const ent = spring({ frame, fps, config: { damping: 14, mass: 0.5 } })
  const sai = interpolate(frame, [durationInFrames - 6, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // O quadro parado sozinho parece defeito; escurecido, parece intenção — e o
  // olho sobe para o rótulo em vez de procurar movimento na imagem.
  return <AbsoluteFill style={{ background: cores.fundo, opacity: ent * (1 - sai) * 0.45 }} />
}

/**
 * O rótulo que acompanha a parada. Desenhado FORA da moldura, no rodapé da
 * composição: em quadro vertical com gravação de desktop sobra metade da tela,
 * e um rótulo preso à moldura ficaria pequeno no meio de um vazio.
 */
const RotuloParada: React.FC<{
  texto: string
  local: number
  frames: number
  escala: number
}> = ({ texto, local, frames, escala }) => {
  const { fps } = useVideoConfig()
  const ent = spring({ frame: local, fps, config: { damping: 14, mass: 0.5 } })
  const sai = interpolate(local, [frames - 6, frames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const visivel = ent * (1 - sai)

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          margin: `0 ${56 * escala}px ${90 * escala}px`,
          padding: `${22 * escala}px ${44 * escala}px`,
          borderRadius: 20 * escala,
          background: `linear-gradient(135deg, ${cores.marcaEscura}, ${cores.marcaProfunda})`,
          color: '#fff',
          fontFamily: SORA,
          fontWeight: 700,
          fontSize: 52 * escala,
          lineHeight: 1.2,
          textAlign: 'center',
          letterSpacing: -0.5,
          boxShadow: `0 ${20 * escala}px ${60 * escala}px rgba(0,0,0,0.55)`,
          transform: `translateY(${(1 - ent) * 44 * escala + sai * 26 * escala}px) scale(${0.9 + ent * 0.1})`,
          opacity: visivel,
        }}
      >
        {texto}
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
 *
 * Por dentro da moldura o clipe é uma `Series`: trechos que andam alternados com
 * paradas congeladas. Ver `segmentos.ts`.
 */
export const Clipe: React.FC<{
  clipe: ClipeConfig
  retrato: boolean
  framesDeMovimento: number
  /** Em retrato o painel lateral só faz sentido quando há quadro sobrando. */
  comPainel?: boolean
}> = ({ clipe, retrato, framesDeMovimento, comPainel = true }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const escala = escalaDoQuadro(width, height)
  const quadroRetrato = height > width

  const entrada = spring({ frame, fps, config: { damping: 16, mass: 0.8 } })
  // Respiro final: a moldura recua um pouco antes de cortar para o próximo bloco.
  const saida = interpolate(frame, [durationInFrames - 18, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Painel lateral só cabe quando a gravação é vertical E o quadro é horizontal.
  const painel = comPainel && retrato && !quadroRetrato

  // Encaixe dentro da caixa disponível, respeitando LARGURA e ALTURA. Calcular
  // só pela altura (como antes) estoura o quadro quando a proporção da gravação
  // e a do vídeo divergem — gravação de desktop num quadro vertical viraria uma
  // moldura mais larga que a tela, cortada em silêncio.
  const aspecto = retrato ? 9 / 16 : 16 / 9
  const larguraMax = width * (painel ? 0.5 : 0.86)
  const alturaMax = height * (painel ? 0.86 : 0.8)
  const larguraMoldura = Math.min(larguraMax, alturaMax * aspecto)
  const alturaMoldura = larguraMoldura / aspecto

  const segmentos = montarSegmentos(clipe, framesDeMovimento, fps)
  const parada = paradaNoFrame(segmentos, frame)

  const video = (trimBefore: number, congelado: boolean) => (
    <OffthreadVideo
      src={staticFile(`videos/${clipe.arquivo}`)}
      trimBefore={trimBefore}
      // Numa parada a taxa não importa (o frame está fixo), e 1 evita que o
      // Remotion procure um tempo de origem além do fim do arquivo.
      playbackRate={congelado ? 1 : clipe.velocidade}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      // A demonstração é narrada por você; o áudio bruto de gravação de tela
      // acelerada só atrapalha.
      muted
    />
  )

  return (
    <AbsoluteFill style={{ backgroundColor: cores.fundo, fontFamily: INTER }}>
      {/* Fundo de marca: gradiente + brilho, para a sobra ao lado do celular
          não ser um vazio preto. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 20%, ${cores.marcaProfunda}33 0%, transparent 55%), linear-gradient(160deg, ${cores.fundoCard} 0%, ${cores.fundo} 55%)`,
        }}
      />

      {/* Marca d'água discreta. Em retrato com painel ela sai: o painel já
          carrega a marca, e as duas juntas brigam. */}
      <div
        style={{
          position: 'absolute',
          top: 48 * escala,
          left: 56 * escala,
          display: 'flex',
          alignItems: 'center',
          gap: 14 * escala,
          opacity: painel ? 0 : 0.9,
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

      {painel ? <PainelLateral clipe={clipe} escala={escala} /> : null}

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          // Gravação de celular em quadro 16:9 deixa 60% da tela vazia. Em vez de
          // esticar o vídeo (que distorce) ou centralizar (que desperdiça), o
          // aparelho vai para a direita e o painel ocupa a sobra com argumento
          // de venda. Sem painel, segue centralizado.
          alignItems: painel ? 'flex-end' : 'center',
          paddingRight: painel ? 150 * escala : 0,
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
          <Series>
            {segmentos.map((segmento, i) =>
              segmento.tipo === 'movimento' ? (
                <Series.Sequence key={i} durationInFrames={segmento.frames}>
                  {video(segmento.trimBefore, false)}
                </Series.Sequence>
              ) : (
                <Series.Sequence key={i} durationInFrames={segmento.frames}>
                  {/* frame={0} com trimBefore no frame desejado mostra exatamente
                      aquele quadro da origem: o Freeze zera o deslocamento da
                      Series, e o OffthreadVideo começa em trimBefore. */}
                  <Freeze frame={0}>{video(segmento.trimBefore, true)}</Freeze>
                  <EscurecerParada />
                </Series.Sequence>
              ),
            )}
          </Series>
        </div>
      </AbsoluteFill>

      {/* Selo de velocidade. Sem ele, uma gravação a 10x parece o app travando
          ou o vídeo com defeito — o cliente precisa ler que a pressa é edição. */}
      {clipe.velocidade >= 1.5 ? (
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
          <span style={{ color: cores.marca }}>▶</span> {Math.round(clipe.velocidade)}× · avanço rápido
        </div>
      ) : null}

      {parada ? (
        <RotuloParada
          texto={parada.texto}
          local={parada.local}
          frames={parada.frames}
          escala={escala}
        />
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
