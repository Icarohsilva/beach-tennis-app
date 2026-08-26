// lib/aulas/studentIdentity.test.ts
import { describe, it, expect } from 'vitest'
import { canPermanentlyDelete, type PermanentDeleteTarget } from './studentIdentity'

const ACTIVE_STUDENT: PermanentDeleteTarget = {
  role: 'student',
  membershipArchivedAt: null,
  profileDeletedAt: null,
  hasActiveMembershipElsewhere: false,
}

describe('canPermanentlyDelete', () => {
  it('recusa aluno ainda ativo nesta academia — exige inativar primeiro', () => {
    const result = canPermanentlyDelete(ACTIVE_STUDENT, false)
    expect(result.ok).toBe(false)
  })

  it('aceita aluno inativado nesta academia, sem vínculo ativo alhures e ainda não excluído', () => {
    const result = canPermanentlyDelete(
      { ...ACTIVE_STUDENT, membershipArchivedAt: '2026-08-01T00:00:00Z' },
      false,
    )
    expect(result).toEqual({ ok: true })
  })

  it('recusa quem já foi excluído permanentemente', () => {
    const result = canPermanentlyDelete(
      {
        ...ACTIVE_STUDENT,
        membershipArchivedAt: '2026-08-01T00:00:00Z',
        profileDeletedAt: '2026-08-10T00:00:00Z',
      },
      false,
    )
    expect(result.ok).toBe(false)
  })

  it('recusa professor/admin — só aluno sai por aqui', () => {
    const result = canPermanentlyDelete(
      { role: 'admin', membershipArchivedAt: '2026-08-01T00:00:00Z', profileDeletedAt: null, hasActiveMembershipElsewhere: false },
      false,
    )
    expect(result.ok).toBe(false)
  })

  it('recusa autoexclusão mesmo que já esteja inativado', () => {
    const result = canPermanentlyDelete(
      { ...ACTIVE_STUDENT, membershipArchivedAt: '2026-08-01T00:00:00Z' },
      true,
    )
    expect(result.ok).toBe(false)
  })

  it('recusa quando o aluno ainda está ativo em outra academia (multi-vínculo)', () => {
    const result = canPermanentlyDelete(
      {
        ...ACTIVE_STUDENT,
        membershipArchivedAt: '2026-08-01T00:00:00Z',
        hasActiveMembershipElsewhere: true,
      },
      false,
    )
    expect(result.ok).toBe(false)
  })
})
