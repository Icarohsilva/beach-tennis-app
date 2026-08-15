// features/aulas/quotaSettings.test.ts
//
// Só o teto diário: a leitura tratava 0 como valor inválido e o trocava por 2, o
// que tornava impossível a academia dizer "sem limite de aulas por dia". O default
// tem de valer para chave AUSENTE, não para chave gravada com 0.
import { describe, it, expect } from 'vitest'
import { getOrgMaxClassesPerDay, isQuotaEnforced } from './quotaSettings'

/** Client mínimo: devolve `value` para qualquer chave pedida. */
function clientReturning(value: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: value === null ? null : { value } }),
          }),
        }),
      }),
    }),
  } as never
}

describe('getOrgMaxClassesPerDay', () => {
  it('0 significa SEM LIMITE e é preservado', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning('0'), 'org')).toBe(0)
  })

  it('valor positivo passa direto', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning('4'), 'org')).toBe(4)
  })

  it('chave ausente cai no default de 2', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning(null), 'org')).toBe(2)
  })

  it('string vazia cai no default (não vira 0 por acidente do Number(""))', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning(''), 'org')).toBe(2)
  })

  it('lixo não numérico cai no default', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning('muitas'), 'org')).toBe(2)
  })

  it('valor quebrado ou negativo cai no default', async () => {
    expect(await getOrgMaxClassesPerDay(clientReturning('2.5'), 'org')).toBe(2)
    expect(await getOrgMaxClassesPerDay(clientReturning('-1'), 'org')).toBe(2)
  })
})

describe('isQuotaEnforced', () => {
  it('só a string "true" liga a regra', async () => {
    expect(await isQuotaEnforced(clientReturning('true'), 'org')).toBe(true)
    expect(await isQuotaEnforced(clientReturning('false'), 'org')).toBe(false)
    expect(await isQuotaEnforced(clientReturning(null), 'org')).toBe(false)
  })
})
