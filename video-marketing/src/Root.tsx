import React from 'react'
import { Composition, staticFile } from 'remotion'
import { parseMedia } from '@remotion/media-parser'
import { Abertura } from './Abertura'
import { Encerramento } from './Encerramento'
import { Demo, DemoProps, Medida, TRANSICAO, duracaoTotal, DUR_ABERTURA, DUR_ENCERRAMENTO } from './Demo'
import { CLIPES, DIMENSOES, FPS, NARRACAO, Clipe as ClipeConfig } from './config'

/** Duração usada quando o arquivo não pôde ser lido — 45s, só para o Studio abrir. */
const FALLBACK_SEGUNDOS = 45

/**
 * Piso de duração de um clipe. A TransitionSeries recusa um bloco mais curto do
 * que a transição que vem depois dele, e o erro que ela levanta não diz qual
 * clipe nem por quê. Sem este piso, uma `velocidade` alta demais para uma
 * gravação curta derruba o render inteiro com uma mensagem indecifrável.
 */
const MIN_FRAMES = TRANSICAO * 2

const comPiso = (frames: number, clipe: ClipeConfig) => {
  if (frames >= MIN_FRAMES) return frames
  // eslint-disable-next-line no-console
  console.warn(
    `[arenahub-video] ${clipe.arquivo} ficou com ${frames} frames a ${clipe.velocidade}x — ` +
      `curto demais para a transição. Segurando em ${MIN_FRAMES}; baixe a velocidade.`,
  )
  return MIN_FRAMES
}

const absoluta = (caminho: string) =>
  typeof window === 'undefined' ? caminho : new URL(caminho, window.location.href).href

/**
 * Mede cada arquivo (duração e orientação) para a timeline não depender de
 * número digitado à mão. Se a leitura falhar, o vídeo ainda monta com uma
 * duração de reserva — melhor um preview aproximado do que o Studio não abrir.
 */
const medir = async (clipes: ClipeConfig[]): Promise<Medida[]> =>
  Promise.all(
    clipes.map(async (clipe): Promise<Medida> => {
      try {
        const { durationInSeconds, dimensions } = await parseMedia({
          src: absoluta(staticFile(`videos/${clipe.arquivo}`)),
          fields: { durationInSeconds: true, dimensions: true },
          acknowledgeRemotionLicense: true,
        })
        const bruto = durationInSeconds ?? FALLBACK_SEGUNDOS
        const util = Math.max(1, bruto - clipe.cortarInicio - clipe.cortarFim)
        return {
          // A aceleração encurta o bloco na mesma proporção: é `playbackRate` no
          // OffthreadVideo (Clipe.tsx) e a divisão aqui, e as duas TÊM de andar
          // juntas — só uma delas e o vídeo corta no meio ou congela no fim.
          frames: comPiso(Math.round((util / Math.max(1, clipe.velocidade)) * FPS), clipe),
          retrato: dimensions ? dimensions.height >= dimensions.width : true,
        }
      } catch (erro) {
        // eslint-disable-next-line no-console
        console.warn(
          `[arenahub-video] não consegui ler public/videos/${clipe.arquivo} — usando ${FALLBACK_SEGUNDOS}s.`,
          erro,
        )
        return {
          frames: comPiso(
            Math.round((FALLBACK_SEGUNDOS / Math.max(1, clipe.velocidade)) * FPS),
            clipe,
          ),
          retrato: true,
        }
      }
    }),
  )

const calcular = async ({ props }: { props: DemoProps }) => {
  const medidas = await medir(props.clipes)
  return { durationInFrames: duracaoTotal(medidas), props: { ...props, medidas } }
}

export const RemotionRoot: React.FC = () => (
  <>
    {/* O vídeo que vai para o cliente. */}
    <Composition
      id="Demo"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA}
      defaultProps={{ clipes: CLIPES, medidas: [] as Medida[], faixas: NARRACAO }}
      calculateMetadata={calcular}
    />

    {/* Recortes: mandar só a parte que interessa para cada conversa. */}
    <Composition
      id="DemoAluno"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA}
      defaultProps={{ clipes: CLIPES.slice(0, 1), medidas: [] as Medida[], faixas: [] }}
      calculateMetadata={calcular}
    />
    <Composition
      id="DemoArena"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA}
      defaultProps={{ clipes: CLIPES.slice(1, 2), medidas: [] as Medida[], faixas: [] }}
      calculateMetadata={calcular}
    />

    {/* Blocos soltos: a abertura serve de vinheta para qualquer outro vídeo. */}
    <Composition
      id="Abertura"
      component={Abertura}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA}
    />
    <Composition
      id="Encerramento"
      component={Encerramento}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ENCERRAMENTO}
    />
  </>
)
