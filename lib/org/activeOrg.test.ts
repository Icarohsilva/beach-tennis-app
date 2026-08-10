import { describe, it, expect } from 'vitest'
import { resolveActiveOrg, hasStudentAccess } from './activeOrg'

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

describe('hasStudentAccess', () => {
  it('aluno e staff têm o menu completo', () => {
    expect(hasStudentAccess([{ role: 'student' }])).toBe(true)
    expect(hasStudentAccess([{ role: 'admin' }])).toBe(true)
    expect(hasStudentAccess([{ role: 'super_admin' }])).toBe(true)
  })

  it('conta livre (sem vínculo) é visitante', () => {
    expect(hasStudentAccess([])).toBe(false)
  })

  it('quem só entrou para jogar torneio é visitante', () => {
    expect(hasStudentAccess([{ role: 'athlete' }])).toBe(false)
    expect(hasStudentAccess([{ role: 'athlete' }, { role: 'athlete' }])).toBe(false)
  })

  it('basta ser aluno em UMA academia para ter o menu completo', () => {
    // Caso real: aluno da academia A que jogou um torneio avulso na B.
    expect(hasStudentAccess([{ role: 'athlete' }, { role: 'student' }])).toBe(true)
  })

  it('papel desconhecido conta como aluno — falha para o lado seguro', () => {
    // Esconder o app de quem paga é pior que mostrar uma aba a mais.
    expect(hasStudentAccess([{ role: 'coach' }])).toBe(true)
  })
})
