import { describe, it, expect } from 'vitest'
import { filterOrganizations, type OrgListRow } from './filterOrgs'

function row(name: string): OrgListRow {
  return {
    id: name,
    name,
    city: null,
    state: null,
    owner_name: null,
    org_status: 'active',
    sub_status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('filterOrganizations', () => {
  it('retorna todas as linhas quando a busca está vazia', () => {
    const rows = [row('Hudson'), row('Arena X')]
    expect(filterOrganizations(rows, '')).toHaveLength(2)
    expect(filterOrganizations(rows, '   ')).toHaveLength(2)
  })

  it('filtra por nome ignorando maiúsculas/minúsculas', () => {
    const rows = [row('Hudson Barros'), row('Arena X')]
    const out = filterOrganizations(rows, 'hudson')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Hudson Barros')
  })

  it('filtra ignorando acentos (São → sao)', () => {
    const rows = [row('São Paulo BT'), row('Arena X')]
    const out = filterOrganizations(rows, 'sao')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('São Paulo BT')
  })

  it('retorna vazio quando nada casa', () => {
    const rows = [row('Hudson'), row('Arena X')]
    expect(filterOrganizations(rows, 'zzz')).toHaveLength(0)
  })
})
