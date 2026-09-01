import React from 'react'
import { Composition, staticFile } from 'remotion'
import { parseMedia } from '@remotion/media-parser'
import { Abertura, DUR_ABERTURA_FRAMES } from './Abertura'
import { Encerramento } from './Encerramento'
import { Convite, ConviteProps, DUR_CHAMADA, duracaoConvite } from './Convite'
import {
  Demo,
  DemoProps,
  JanelaFala,
  Medida,
  TRANSICAO,
  duracaoTotal,
  DUR_ENCERRAMENTO,
} from './Demo'
import { duracaoDosSegmentos, montarSegmentos } from './segmentos'
import {
  CLIPES,
  CONVITE,
  DIMENSOES,
  DIMENSOES_CONVITE,
  EFEITOS,
  FPS,
  NARRACAO,
  TRILHA,
  Clipe as ClipeConfig,
  Faixa,
} from './config'

/** Duração usada quando o arquivo não pôde ser lido — 45s, só para o Studio abrir. */
const FALLBACK_SEGUNDOS = 45

/**
 * Piso de duração de um clipe. A TransitionSeries recusa um bloco mais curto do
 * que a transição que vem depois dele, e o erro que ela levanta não diz qual
 * clipe nem por quê. Sem este piso, uma `velocidade` alta demais para uma
 * gravação curta derruba o render inteiro com uma mensagem indecifrável.
 */
const MIN_FRAMES = TRANSICAO * 2

const absoluta = (caminho: string) =>
  typeof window === 'undefined' ? caminho : new URL(caminho, window.location.href).href

/** Duração bruta de um arquivo, em segundos, com aviso em vez de erro. */
const duracaoDe = async (caminho: string, rotulo: string) => {
  try {
    const { durationInSeconds, dimensions } = await parseMedia({
      src: absoluta(staticFile(caminho)),
      fields: { durationInSeconds: true, dimensions: true },
      acknowledgeRemotionLicense: true,
    })
    return {
      segundos: durationInSeconds ?? FALLBACK_SEGUNDOS,
      retrato: dimensions ? dimensions.height >= dimensions.width : true,
      lido: true,
    }
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.warn(`[arenahub-video] não consegui ler ${rotulo} — usando ${FALLBACK_SEGUNDOS}s.`, erro)
    return { segundos: FALLBACK_SEGUNDOS, retrato: true, lido: false }
  }
}

/**
 * Mede cada gravação e devolve quanto ela ocupa na montagem.
 *
 * Três coisas saem daqui e as três precisam concordar entre si: a duração total
 * do bloco, a duração só da parte que anda (que `montarSegmentos` fatia) e a
 * orientação (que escolhe a moldura). Tudo derivado do arquivo — nenhum número
 * digitado à mão, para que regravar não obrigue a reajustar a linha do tempo.
 */
const medir = async (clipes: ClipeConfig[]): Promise<Medida[]> =>
  Promise.all(
    clipes.map(async (clipe): Promise<Medida> => {
      const { segundos, retrato } = await duracaoDe(`videos/${clipe.arquivo}`, clipe.arquivo)
      const util = Math.max(1, segundos - clipe.cortarInicio - clipe.cortarFim)
      // A aceleração encurta a parte que anda; as paradas somam por cima.
      const framesDeMovimento = Math.max(
        MIN_FRAMES,
        Math.round((util / Math.max(1, clipe.velocidade)) * FPS),
      )
      const frames = duracaoDosSegmentos(montarSegmentos(clipe, framesDeMovimento, FPS))

      if (framesDeMovimento === MIN_FRAMES) {
        // eslint-disable-next-line no-console
        console.warn(
          `[arenahub-video] ${clipe.arquivo} a ${clipe.velocidade}x ficou curto demais para a ` +
            `transição. Segurando em ${MIN_FRAMES} frames; baixe a velocidade.`,
        )
      }

      return { frames, framesDeMovimento, retrato }
    }),
  )

/**
 * Onde a narração fala, para a trilha abaixar sozinha. Mede os próprios arquivos
 * de narração: janela digitada à mão desregula na primeira regravação, e o
 * defeito (música por cima da voz) só aparece ouvindo o render pronto.
 */
const medirFala = async (faixas: Faixa[]): Promise<JanelaFala[]> =>
  Promise.all(
    faixas.map(async (faixa): Promise<JanelaFala> => {
      const { segundos } = await duracaoDe(`audio/${faixa.arquivo}`, faixa.arquivo)
      return { de: Math.round(faixa.em * FPS), ate: Math.round((faixa.em + segundos) * FPS) }
    }),
  )

const calcularDemo = async ({ props }: { props: DemoProps }) => {
  const [medidas, janelasFala] = await Promise.all([medir(props.clipes), medirFala(props.faixas)])
  return {
    durationInFrames: duracaoTotal(medidas),
    props: { ...props, medidas, janelasFala },
  }
}

/**
 * O convite não define velocidade: ele pede "me dá 8 segundos desta gravação" e
 * a velocidade sai da duração real do arquivo. Assim a mesma gravação serve aos
 * dois vídeos, e trocá-la por uma mais longa não desregula o convite.
 */
const calcularConvite = async ({ props }: { props: ConviteProps }) => {
  const brutos = await Promise.all(
    CLIPES.map((clipe) => duracaoDe(`videos/${clipe.arquivo}`, clipe.arquivo)),
  )

  const clipes: ClipeConfig[] = CLIPES.map((clipe, i) => {
    const bloco = CONVITE.blocos[i]
    const util = Math.max(1, brutos[i].segundos - clipe.cortarInicio - clipe.cortarFim)
    const alvo = bloco?.segundos ?? 8
    return {
      ...clipe,
      velocidade: Math.max(1, util / alvo),
      paradas: bloco?.paradas ?? [],
      legendas: [],
    }
  })

  const [medidas, janelasFala] = await Promise.all([medir(clipes), medirFala(props.faixas)])
  return {
    durationInFrames: duracaoConvite(medidas),
    props: { ...props, clipes, medidas, janelasFala },
  }
}

const audioPadrao = { faixas: NARRACAO, trilha: TRILHA, efeitos: EFEITOS, janelasFala: [] as JanelaFala[] }
const semAudio = { faixas: [] as Faixa[], trilha: [] as Faixa[], efeitos: [] as Faixa[], janelasFala: [] as JanelaFala[] }

export const RemotionRoot: React.FC = () => (
  <>
    {/* O vídeo curto que acompanha o "oi" no WhatsApp. Sempre vertical. */}
    <Composition
      id="Convite"
      component={Convite}
      fps={FPS}
      {...DIMENSOES_CONVITE}
      durationInFrames={DUR_ABERTURA_FRAMES + DUR_CHAMADA}
      defaultProps={{ clipes: CLIPES, medidas: [] as Medida[], ...audioPadrao }}
      calculateMetadata={calcularConvite}
    />

    {/* A apresentação completa, enviada depois que a arena responde. */}
    <Composition
      id="Demo"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA_FRAMES}
      defaultProps={{ clipes: CLIPES, medidas: [] as Medida[], ...audioPadrao }}
      calculateMetadata={calcularDemo}
    />

    {/* Recortes: mandar só a parte que interessa para cada conversa. Sem áudio,
        porque os tempos das faixas são medidos no vídeo completo. */}
    <Composition
      id="DemoArena"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA_FRAMES}
      defaultProps={{ clipes: CLIPES.slice(0, 1), medidas: [] as Medida[], ...semAudio }}
      calculateMetadata={calcularDemo}
    />
    <Composition
      id="DemoAluno"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA_FRAMES}
      defaultProps={{ clipes: CLIPES.slice(1, 2), medidas: [] as Medida[], ...semAudio }}
      calculateMetadata={calcularDemo}
    />

    {/* Blocos soltos: a abertura serve de vinheta para qualquer outro vídeo. */}
    <Composition
      id="Abertura"
      component={Abertura}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA_FRAMES}
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
