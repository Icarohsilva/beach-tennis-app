import React from 'react'
import { Composition, staticFile } from 'remotion'
import { parseMedia } from '@remotion/media-parser'
import { Abertura, DUR_ABERTURA_FRAMES } from './Abertura'
import { Encerramento } from './Encerramento'
import { Convite, ConviteProps, DUR_CHAMADA, duracaoConvite } from './Convite'
import { Demo, DemoProps, JanelaFala, Medida, duracaoTotal, DUR_ENCERRAMENTO } from './Demo'
import { ajustarAoArquivo, duracaoDosSegmentos, montarSegmentos } from './segmentos'
import {
  CLIPES,
  CONVITE,
  DIMENSOES,
  DIMENSOES_CONVITE,
  EFEITOS,
  FPS,
  NARRACAO_CONVITE,
  NARRACAO_DEMO,
  TRILHA,
  Clipe as ClipeConfig,
  Faixa,
} from './config'

/** Duração usada quando o arquivo não pôde ser lido — só para o Studio abrir. */
const FALLBACK_SEGUNDOS = 60

const absoluta = (caminho: string) =>
  typeof window === 'undefined' ? caminho : new URL(caminho, window.location.href).href

/** Duração e orientação de um arquivo, com aviso no console em vez de erro. */
const lerArquivo = async (caminho: string, rotulo: string) => {
  try {
    const { durationInSeconds, dimensions } = await parseMedia({
      src: absoluta(staticFile(caminho)),
      fields: { durationInSeconds: true, dimensions: true },
      acknowledgeRemotionLicense: true,
    })
    return {
      segundos: durationInSeconds ?? FALLBACK_SEGUNDOS,
      // null quando o arquivo não expõe as dimensões — quem chama decide, com
      // aviso, em vez de adivinhar aqui.
      retrato: dimensions ? dimensions.height >= dimensions.width : null,
    }
  } catch (erro) {
    // eslint-disable-next-line no-console
    console.warn(
      `[arenahub-video] não consegui ler public/${caminho} (${rotulo}) — ` +
        `usando ${FALLBACK_SEGUNDOS}s. Confira o nome do arquivo.`,
      erro,
    )
    return { segundos: FALLBACK_SEGUNDOS, retrato: null }
  }
}

/**
 * Decide a moldura: o que o config mandar, ou a proporção lida do arquivo.
 *
 * Quando o config diz 'auto' e o arquivo não expõe dimensões, avisa e assume
 * PAISAGEM. Assumir retrato em silêncio era o comportamento anterior, e ele põe
 * gravação de desktop dentro de um celular desenhado: a imagem sai cortada e o
 * defeito parece do app, não da edição.
 */
const resolverOrientacao = (clipe: ClipeConfig, lido: boolean | null) => {
  if (clipe.orientacao === 'retrato') return true
  if (clipe.orientacao === 'paisagem') return false
  if (lido !== null) return lido
  // eslint-disable-next-line no-console
  console.warn(
    `[arenahub-video] não consegui ler a proporção de ${clipe.arquivo}; assumindo paisagem. ` +
      `Se a gravação for de celular, ponha orientacao: 'retrato' no config.`,
  )
  return false
}

/**
 * Apara os trechos ao tamanho real da gravação e mede quanto cada bloco ocupa.
 *
 * A duração do bloco vem dos TRECHOS escolhidos, não do arquivo: é a soma de
 * (ate - de) / velocidade. O arquivo só é lido por duas razões — descobrir a
 * orientação (que escolhe a moldura) e cortar um `ate` que passe do fim, que
 * senão congelaria o último quadro pelo tempo que sobrasse, sem avisar.
 */
const prepararClipes = async (clipes: ClipeConfig[]) => {
  const lidos = await Promise.all(
    clipes.map(async (clipe) => {
      const { segundos, retrato } = await lerArquivo(`videos/${clipe.arquivo}`, clipe.arquivo)
      const ajustado = ajustarAoArquivo(clipe, segundos)
      const frames = duracaoDosSegmentos(montarSegmentos(ajustado, FPS))
      const medida: Medida = { frames, retrato: resolverOrientacao(clipe, retrato) }
      return { clipe: ajustado, medida }
    }),
  )
  return {
    clipes: lidos.map((l) => l.clipe),
    medidas: lidos.map((l) => l.medida),
  }
}

/**
 * Onde a narração fala, para a trilha abaixar sozinha. Mede os próprios arquivos
 * de narração: janela digitada à mão desregula na primeira regravação, e o
 * defeito (música por cima da voz) só aparece ouvindo o render pronto.
 */
const medirFala = async (faixas: Faixa[]): Promise<JanelaFala[]> =>
  Promise.all(
    faixas.map(async (faixa): Promise<JanelaFala> => {
      const { segundos } = await lerArquivo(`audio/${faixa.arquivo}`, faixa.arquivo)
      return { de: Math.round(faixa.em * FPS), ate: Math.round((faixa.em + segundos) * FPS) }
    }),
  )

const calcularDemo = async ({ props }: { props: DemoProps }) => {
  const [{ clipes, medidas }, janelasFala] = await Promise.all([
    prepararClipes(props.clipes),
    medirFala(props.faixas),
  ])
  return { durationInFrames: duracaoTotal(medidas), props: { ...props, clipes, medidas, janelasFala } }
}

/**
 * O convite usa as MESMAS gravações, com trechos próprios (mais curtos). Trocar
 * a gravação por outra não desregula nada: os trechos são aparados ao arquivo.
 */
const calcularConvite = async ({ props }: { props: ConviteProps }) => {
  const base: ClipeConfig[] = CLIPES.map((clipe, i) => ({
    ...clipe,
    trechos: CONVITE.trechos[i] ?? clipe.trechos.slice(0, 1),
    legendas: [],
  }))
  const [{ clipes, medidas }, janelasFala] = await Promise.all([
    prepararClipes(base),
    medirFala(props.faixas),
  ])
  return { durationInFrames: duracaoConvite(medidas), props: { ...props, clipes, medidas, janelasFala } }
}

const semAudio = {
  faixas: [] as Faixa[],
  trilha: [] as Faixa[],
  efeitos: [] as Faixa[],
  janelasFala: [] as JanelaFala[],
}

export const RemotionRoot: React.FC = () => (
  <>
    {/* O vídeo curto que acompanha o "oi" no WhatsApp. Sempre vertical. */}
    <Composition
      id="Convite"
      component={Convite}
      fps={FPS}
      {...DIMENSOES_CONVITE}
      durationInFrames={DUR_ABERTURA_FRAMES + DUR_CHAMADA}
      defaultProps={{
        clipes: CLIPES,
        medidas: [] as Medida[],
        // Narração PRÓPRIA do convite: os dois vídeos têm blocos e durações
        // diferentes, e uma lista compartilhada faria as faixas de um cair no
        // lugar errado do outro — ou fora dele, sumindo sem aviso nenhum.
        faixas: NARRACAO_CONVITE,
        trilha: TRILHA,
        efeitos: EFEITOS,
        janelasFala: [] as JanelaFala[],
      }}
      calculateMetadata={calcularConvite}
    />

    {/* A apresentação completa, enviada depois que a arena responde. */}
    <Composition
      id="Demo"
      component={Demo}
      fps={FPS}
      {...DIMENSOES}
      durationInFrames={DUR_ABERTURA_FRAMES}
      defaultProps={{
        clipes: CLIPES,
        medidas: [] as Medida[],
        faixas: NARRACAO_DEMO,
        trilha: TRILHA,
        efeitos: EFEITOS,
        janelasFala: [] as JanelaFala[],
      }}
      calculateMetadata={calcularDemo}
    />

    {/* Recortes: mandar só a parte que interessa. Sem áudio, porque os tempos
        das faixas são medidos no vídeo completo. */}
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
