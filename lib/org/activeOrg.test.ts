import { describe, it, expect } from 'vitest'
import { resolveActiveOrg } from './activeOrg'

const m = (organization_id: string) => ({ organization_id })

describe('resolveActiveOrg', () => {
  it('sem memberships → none', () => {
    expect(resolveActiveOrg([], null)).toEqual({ status: 'none' })
    expect(resolveActiveOrg([], 'org-1')).toEqual({ status: 'none' })
  })
  it('uma membership → ativa ela (ignora cookie inválido)', () => {
    expect(resolveActiveOrg([m('org-1')], null)).toEqual({ status: 'active', orgId: 'org-1' })
    expect(resolveActiveOrg([m('org-1')], 'lixo')).toEqual({ status: 'active', orgId: 'org-1' })
  })
  it('2+ e cookie válido → usa o cookie', () => {
    expect(resolveActiveOrg([m('org-1'), m('org-2')], 'org-2')).toEqual({ status: 'active', orgId: 'org-2' })
  })
  it('2+ e cookie ausente/inválido → choose', () => {
    expect(resolveActiveOrg([m('org-1'), m('org-2')], null)).toEqual({ status: 'choose' })
    expect(resolveActiveOrg([m('org-1'), m('org-2')], 'org-9')).toEqual({ status: 'choose' })
  })
})
