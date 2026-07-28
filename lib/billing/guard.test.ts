import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// O bloqueio de cobrança só funciona se CADA página do painel chamar o gate: layout e
// template não re-executam em navegação client-side (ver lib/billing/guard.ts). Uma
// página nova sem a chamada reabre o buraco silenciosamente — e nenhum teste de
// unidade pegaria isso. Este teste varre o diretório e falha na hora.
const RAIZ_ADMIN = join(process.cwd(), 'app', '(admin)', 'admin')

// Única isenta: é o destino do redirect, gate nela viraria loop.
const ISENTAS = ['assinatura']

function paginas(dir: string, rel: string[] = []): string[][] {
  const achadas: string[][] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      achadas.push(...paginas(join(dir, item.name), [...rel, item.name]))
    } else if (item.name === 'page.tsx') {
      achadas.push([join(dir, item.name), rel.join('/')])
    }
  }
  return achadas
}

describe('gate de cobrança nas páginas do painel admin', () => {
  const todas = paginas(RAIZ_ADMIN)

  it('encontra as páginas do painel', () => {
    expect(todas.length).toBeGreaterThan(10)
  })

  it('toda página não isenta chama requirePlatformAccess()', () => {
    const semGate = todas
      .filter(([, rota]) => !ISENTAS.some((i) => rota === i || rota.startsWith(`${i}/`)))
      .filter(([caminho]) => !readFileSync(caminho, 'utf8').includes('requirePlatformAccess()'))
      .map(([, rota]) => rota || '(raiz)')

    expect(semGate).toEqual([])
  })

  it('a página de assinatura NÃO chama o gate (senão vira loop de redirect)', () => {
    const [caminho] = todas.find(([, rota]) => rota === 'assinatura')!
    expect(readFileSync(caminho, 'utf8')).not.toContain('requirePlatformAccess()')
  })
})
