import { describe, it, expect } from 'vitest'
import { resolveActiveOrg, hasStudentAccess, isStaffOfActiveOrg } from './activeOrg'

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

describe('isStaffOfActiveOrg', () => {
  const admin = { organization_id: 'org-1', role: 'admin' }
  const aluno = { organization_id: 'org-1', role: 'student' }

  it('admin da academia ativa é staff', () => {
    expect(isStaffOfActiveOrg([admin], 'org-1')).toBe(true)
  })

  it('aluno não é staff', () => {
    expect(isStaffOfActiveOrg([aluno], 'org-1')).toBe(false)
  })

  // Ser admin numa academia não pode abrir o painel de outra: o link levaria a
  // um redirect de volta, e no pior caso sugeriria acesso que não existe.
  it('admin de OUTRA academia não é staff na ativa', () => {
    expect(isStaffOfActiveOrg([{ organization_id: 'org-2', role: 'admin' }], 'org-1')).toBe(false)
  })

  it('escolhe a membership da academia ativa quando há várias', () => {
    const ms = [{ organization_id: 'org-1', role: 'student' }, { organization_id: 'org-2', role: 'admin' }]
    expect(isStaffOfActiveOrg(ms, 'org-1')).toBe(false)
    expect(isStaffOfActiveOrg(ms, 'org-2')).toBe(true)
  })

  // Academia ativa não resolvida: sem isso o `.some` compararia com undefined e
  // um membership com organization_id nulo passaria por engano.
  it('sem academia ativa, ninguém é staff', () => {
    expect(isStaffOfActiveOrg([admin], null)).toBe(false)
  })

  it('sem membership nenhuma, não é staff', () => {
    expect(isStaffOfActiveOrg([], 'org-1')).toBe(false)
  })
})
