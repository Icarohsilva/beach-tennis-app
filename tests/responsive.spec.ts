// tests/responsive.spec.ts
// Responsividade dos componentes de risco, medida na bancada de fixtures
// (app/dev/responsivo). Roda SEM credencial de Supabase — é a parte que qualquer
// pessoa, e o CI, consegue rodar num container limpo.
//
// Para as rotas reais do app (que exigem sessão e banco), ver responsive-rotas.spec.ts.
import { test, expect } from '@playwright/test'
import {
  LARGURAS,
  emLargura,
  elementosQueEstouram,
  esperarSemRolagemHorizontal,
  linhasDeTexto,
} from './overflow'

const BANCADA = '/dev/responsivo'

/** Um bloco por componente; o nome casa com o `data-rig` da bancada. */
const BLOCOS = [
  'hero-header',
  'class-card',
  'checkin-progress',
  'frequencia',
  'liga-hero',
  'standings-table',
  'division-ranking',
  'event-stats',
  'stat-cards-moeda',
  'linha-rotulo-chip',
] as const

for (const width of LARGURAS) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      // O aviso de cookies é fixo no rodapé e encobriria metade da bancada nos
      // screenshots — que são o artefato desta suíte. Mesma chave do componente.
      await page.addInitScript(() =>
        window.localStorage.setItem('arenahub_cookie_notice_dismissed_v1', '1'),
      )
      await page.goto(BANCADA)
      await emLargura(page, width)
    })

    test('a bancada não rola de lado', async ({ page }) => {
      await esperarSemRolagemHorizontal(page, width)
    })

    test('a bancada tem todos os blocos esperados', async ({ page }) => {
      // Sem isto, um bloco removido por engano transformaria a suíte em verde vazio:
      // "nenhum elemento estoura" é trivialmente verdadeiro sobre nada.
      for (const bloco of BLOCOS) {
        await expect(page.locator(`[data-rig="${bloco}"]`)).toHaveCount(1)
      }
    })

    for (const bloco of BLOCOS) {
      test(`nenhum elemento estoura em ${bloco}`, async ({ page }) => {
        const culpados = await elementosQueEstouram(page, `[data-rig="${bloco}"]`)
        expect(culpados, `estouros em ${bloco} @ ${width}px:\n${culpados.join('\n')}`).toEqual([])
      })
    }

    // Contrato de legibilidade, não de geometria: um rótulo de KPI é uma etiqueta,
    // não um parágrafo. Sem esta asserção a suíte fica cega para o defeito original
    // do hero — em 3 colunas fixas a caixa tinha ~53px em 320px e
    // "CHECK-INS DO MÊS · WELLHUB" se desdobrava em 5 linhas empilhadas contra o
    // número e a dica. Não estourava nada; só ficava ilegível.
    test('rótulo de KPI não vira parágrafo', async ({ page }) => {
      const linhas = await linhasDeTexto(
        page,
        '[data-rig="hero-header"] p.uppercase:not([data-rig-label])',
      )
      expect(linhas.length, 'nenhum rótulo encontrado no hero').toBeGreaterThan(0)
      linhas.forEach((n, i) => {
        expect(n, `rótulo #${i} do hero ocupa ${n} linhas em ${width}px`).toBeLessThanOrEqual(2)
      })
    })

    // Valor de KPI é um número, não um parágrafo. Um estouro não acusa isto: o
    // `break-words` que antes evitava o transbordo quebrava "R$ 12.345,67" DENTRO do
    // número, em "R$" / "12.345," / "67" — geometricamente correto e ilegível.
    test('valor de KPI não quebra em várias linhas', async ({ page }) => {
      const linhas = await linhasDeTexto(
        page,
        '[data-rig="stat-cards-moeda"] p.font-extrabold',
      )
      expect(linhas.length, 'nenhum valor encontrado nos stat cards').toBeGreaterThan(0)
      linhas.forEach((n, i) => {
        expect(n, `valor #${i} ocupa ${n} linhas em ${width}px`).toBe(1)
      })
    })

    // O nome do plano contra o chip de status: com o chip `shrink-0` e sem permissão
    // de quebrar a linha, o nome era comprimido a ~60px e virava uma coluna de 5
    // linhas de uma palavra cada. Nada estourava; ficava impossível de ler.
    test('título ao lado de chip não afina em coluna de palavras', async ({ page }) => {
      const linhas = await linhasDeTexto(page, '[data-rig="linha-rotulo-chip"] h3')
      expect(linhas.length, 'nenhum título encontrado').toBeGreaterThan(0)
      linhas.forEach((n) => {
        expect(n, `o título ocupa ${n} linhas em ${width}px`).toBeLessThanOrEqual(3)
      })
    })

    test('screenshot da bancada', async ({ page }, testInfo) => {
      // Caminho fixo, não só `testInfo.attach`: com o reporter `list` (CI) os anexos
      // não chegam ao disco, e em tarefa de responsividade o screenshot É o
      // entregável — é olhando o 320px que se confere o resultado.
      const arquivo = `tests/.artifacts/bancada-${width}px.png`
      const png = await page.screenshot({ fullPage: true, path: arquivo })
      await testInfo.attach(`bancada-${width}px.png`, { body: png, contentType: 'image/png' })
    })
  })
}
