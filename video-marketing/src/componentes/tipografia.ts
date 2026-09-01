import { continueRender, delayRender, staticFile } from 'remotion'

// Mesmas duas fontes do app (app/layout.tsx): Sora nos títulos, Inter no corpo.
//
// Servidas de public/fonts em vez do CDN do Google de propósito: pelo CDN o
// render faz mais de cem requisições por aba, e um render sem rede (ou atrás de
// proxy) cai para a fonte de sistema e entrega o vídeo com outra tipografia sem
// avisar. Os dois arquivos são variáveis: um por família cobre todos os pesos.
export const SORA = 'Sora'
export const INTER = 'Inter'

const ARQUIVOS = [
  { familia: SORA, arquivo: 'fonts/Sora-latin.woff2' },
  { familia: INTER, arquivo: 'fonts/Inter-latin.woff2' },
]

// Carregamos pela FontFace API em vez de `loadFont` do @remotion/fonts porque
// aquele abre um delayRender próprio de 28s que não dá para configurar: quando a
// aba já está decodificando a gravação de tela, a fonte demora mais do que isso
// para assentar e o render inteiro morre no meio. Aqui o teto é nosso.
const espera = delayRender('Carregando Sora e Inter', { timeoutInMilliseconds: 120_000 })

Promise.all(
  ARQUIVOS.map(async ({ familia, arquivo }) => {
    const fonte = new FontFace(familia, `url(${staticFile(arquivo)}) format('woff2')`, {
      weight: '400 700',
    })
    await fonte.load()
    document.fonts.add(fonte)
  }),
)
  .then(() => continueRender(espera))
  .catch((erro) => {
    // Continuar com a fonte de sistema é melhor do que não entregar vídeo — mas
    // o aviso precisa aparecer, senão o defeito só se descobre no arquivo final.
    // eslint-disable-next-line no-console
    console.error('[arenahub-video] falha ao carregar as fontes de public/fonts', erro)
    continueRender(espera)
  })
