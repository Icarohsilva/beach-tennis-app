import React from 'react'
import { Composition, staticFile } from 'remotion'
import { parseMedia } from '@remotion/media-parser'
import { Abertura, DUR_ABERTURA_FRAMES } from './Abertura'
import { Encerramento } from './Encerramento'
import { Convite, ConviteProps, DUR_CONVITE } from './Convite'
import { Demo, DemoProps, JanelaFala, Medida, duracaoTotal, DUR_ENCERRAMENTO } from './Demo'
import { framesDoClipe, nomeAcelerado, resolverFonte } from './fonte'
import {
  CLIPES,
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
const lerArquivo = async (caminho: string, rotulo: string, silencioso = false) => {
  try {
    const { durationInSeconds, dimensions } = await parseMedia({
      src: absoluta(staticFile(caminho)),
      fields: { durationInSeconds: true, dimensions: true },
      acknowledgeRemotionLicense: true,
    })
    return {
      existe: true,
      segundos: durationInSeconds ?? FALLBACK_SEGUNDOS,
      // null quando o arquivo não expõe as dimensões — quem chama decide, com
      // aviso, em vez de adivinhar aqui.
      retrato: dimensions ? dimensions.height >= dimensions.width : null,
    }
  } catch (erro) {
    if (!silencioso) {
      // eslint-disable-next-line no-console
      console.warn(
        `[arenahub-video] não consegui ler public/${caminho} (${rotulo}) — ` +
          `usando ${FALLBACK_SEGUNDOS}s. Confira o nome do arquivo.`,
        erro,
      )
    }
    return { existe: false, segundos: FALLBACK_SEGUNDOS, retrato: null }
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
 * Descobre, para cada gravação, QUAL arquivo tocar e quanto tempo ele ocupa.
 *
 * O caminho normal é o arquivo pré-acelerado (`admin--20x.mp4`, gerado por
 * `npm run acelerar`), tocado a 1×. Quando ele ainda não existe, cai no bruto com
 * a taxa limitada a 16× e avisa o que rodar — o vídeo sai mais longo do que o
 * pedido, mas visível, em vez de estourar `NotSupportedError` no Studio.
 */
const prepararClipes = async (clipes: ClipeConfig[]) => {
  const medidas = await Promise.all(
    clipes.map(async (clipe): Promise<Medida> => {
      const acelerado = nomeAcelerado(clipe.arquivo, clipe.velocidade)
      const tentativa =
        clipe.velocidade > 1 ? await lerArquivo(`videos/${acelerado}`, acelerado, true) : null

      if (clipe.velocidade > 1 && !tentativa?.existe) {
        // eslint-disable-next-line no-console
        console.warn(
          `[arenahub-video] ${acelerado} não existe — tocando ${clipe.arquivo} no bruto, ` +
            `limitado a 16×. Rode "npm run acelerar" para gerar o arquivo a ${clipe.velocidade}×.`,
        )
      }

      const fonte = resolverFonte(clipe, Boolean(tentativa?.existe))
      const lido =
        fonte.acelerado && tentativa
          ? tentativa
          : await lerArquivo(`videos/${clipe.arquivo}`, clipe.arquivo)

      return {
        frames: framesDoClipe(lido.segundos, fonte.taxa, FPS),
        retrato: resolverOrientacao(clipe, lido.retrato),
        arquivo: fonte.arquivo,
        taxa: fonte.taxa,
      }
    }),
  )
  return medidas
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

/**
 * Confere que as faixas declaradas existem mesmo.
 *
 * Trilha e efeitos não passam por `medirFala`, então um nome errado ou um arquivo
 * fora da pasta ficava MUDO em silêncio — o vídeo saía sem música e sem nenhuma
 * pista do porquê. Aqui é só uma sondagem: lê e avisa.
 */
const conferirAudio = async (faixas: Faixa[]) => {
  await Promise.all(faixas.map((f) => lerArquivo(`audio/${f.arquivo}`, f.arquivo)))
}

const calcularDemo = async ({ props }: { props: DemoProps }) => {
  const [medidas, janelasFala] = await Promise.all([
    prepararClipes(props.clipes),
    medirFala(props.faixas),
    conferirAudio([...props.trilha, ...props.efeitos]),
  ])
  return { durationInFrames: duracaoTotal(medidas), props: { ...props, medidas, janelasFala } }
}

/** O Convite não tem gravação: são imagens. Só o áudio precisa ser medido. */
const calcularConvite = async ({ props }: { props: ConviteProps }) => {
  const [janelasFala] = await Promise.all([
    medirFala(props.faixas),
    conferirAudio([...props.trilha, ...props.efeitos]),
  ])
  return { durationInFrames: DUR_CONVITE, props: { ...props, janelasFala } }
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
      durationInFrames={DUR_CONVITE}
      defaultProps={{
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
