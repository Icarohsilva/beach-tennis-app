// tests/overflow.ts
// A medição compartilhada pelas duas specs de responsividade.
//
// A asserção é sempre a mesma: nada pode ser mais largo que o espaço que tem.
// É ela que pega o sintoma relatado pela academia — "uma coisa em cima da outra,
// texto em cima do outro" é o que se vê quando um filho estoura o pai e o layout
// se reorganiza por cima de si mesmo.
import { expect, type Page } from '@playwright/test'

/** Larguras CSS reais: iPhone SE (320), iPhone 11 (375), iPhone 11 Pro Max (414). */
export const LARGURAS = [320, 375, 414] as const

/** Altura só para o viewport ter forma; nenhuma asserção depende dela. */
const ALTURA = 900

export async function emLargura(page: Page, width: number) {
  await page.setViewportSize({ width, height: ALTURA })
  // O layout pode mudar depois da hidratação (componentes 'use client').
  await page.waitForLoadState('networkidle')
}

/**
 * O conteúdo da página não passa da largura da tela.
 *
 * Medido no `body`, não no `documentElement`: `html` tem `overflow-x: clip`
 * (globals.css) como rede de segurança em produção, e isso zera o scrollWidth do
 * elemento raiz — medir lá daria um teste que nunca falha. O body não é cortado,
 * então continua acusando conteúdo largo demais.
 */
export async function esperarSemRolagemHorizontal(page: Page, width: number) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }))

  expect(
    scrollWidth,
    `o conteúdo passa ${scrollWidth - innerWidth}px da tela em ${width}px`,
  ).toBeLessThanOrEqual(innerWidth)
}

/**
 * Quantas linhas cada elemento casado por `seletor` ocupa.
 *
 * Complementa a medição de estouro, que sozinha tem um ponto cego importante: um
 * rótulo dentro de uma caixa estreita demais e com quebra permitida NÃO estoura —
 * ele viborneia em 4-5 linhas. Geometricamente está tudo certo; na tela é o
 * amontoado que a academia descreveu como "texto em cima do outro". Contar linhas
 * é o que transforma "apertado" em asserção.
 */
export async function linhasDeTexto(page: Page, seletor: string): Promise<number[]> {
  return page.evaluate((seletor) => {
    return Array.from(document.querySelectorAll(seletor)).map((el) => {
      const estilo = getComputedStyle(el)
      const lineHeight = Number.parseFloat(estilo.lineHeight)
      // `line-height: normal` não vira número: aproxima por 1.2× o font-size, que é
      // o padrão da maioria dos navegadores.
      const altura = Number.isNaN(lineHeight)
        ? Number.parseFloat(estilo.fontSize) * 1.2
        : lineHeight
      return Math.round((el as HTMLElement).getBoundingClientRect().height / altura)
    })
  }, seletor)
}

/**
 * Nenhum elemento estoura o pai SEM ser contido.
 *
 * O critério é `overflow-x: visible` + conteúdo mais largo que a caixa. Esse é o
 * caso que produz o sintoma relatado: o conteúdo é pintado FORA do elemento, por
 * cima do vizinho. Quem tem overflow-x diferente de `visible` está resolvido por
 * construção — o conteúdo é cortado ou rola, não invade ninguém.
 *
 * Sem esse recorte a medição vira ruído puro, por dois motivos:
 *
 * - `truncate` (do Tailwind) é `overflow:hidden` + `text-overflow:ellipsis`, e um
 *   elemento truncando SEMPRE tem scrollWidth > clientWidth. É o mecanismo das
 *   reticências funcionando, não um defeito.
 * - Faixas de rolagem horizontal (agenda da semana, bracket) são mais largas que a
 *   tela de propósito; a subárvore delas também não é medida, porque lá dentro
 *   passar da viewport é o comportamento desejado.
 *
 * `tolerancia` absorve o arredondamento sub-pixel do layout.
 */
export async function elementosQueEstouram(
  page: Page,
  raiz: string,
  tolerancia = 1,
): Promise<string[]> {
  return page.evaluate(
    ({ raiz, tolerancia }) => {
      const root = document.querySelector(raiz)
      if (!root) return [`seletor não encontrado: ${raiz}`]

      const culpados: string[] = []

      const descrever = (el: Element) => {
        const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join('.')
        const texto = (el.textContent ?? '').trim().slice(0, 40)
        return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> "${texto}"`
      }

      const visitar = (el: Element) => {
        const estilo = getComputedStyle(el)
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return

        const rola = estilo.overflowX === 'auto' || estilo.overflowX === 'scroll'
        const contido = estilo.overflowX !== 'visible'

        if (!contido && el.scrollWidth > el.clientWidth + tolerancia) {
          culpados.push(`${descrever(el)} — ${el.scrollWidth}px em ${el.clientWidth}px`)
        }

        if (rola) return
        for (const filho of Array.from(el.children)) visitar(filho)
      }

      visitar(root)
      return culpados
    },
    { raiz, tolerancia },
  )
}
