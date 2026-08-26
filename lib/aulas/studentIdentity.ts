// lib/aulas/studentIdentity.ts
// Quando dá para excluir um aluno PERMANENTEMENTE (bloquear login + anonimizar
// identidade). Regra pura, separada de features/aulas/studentIdentityActions.ts
// para poder testar sem Supabase — mesmo padrão de archiveStudent/reactivateStudent.
export interface PermanentDeleteTarget {
  role: string
  /** Cadastro inativado NESTA academia (memberships.archived_at). */
  membershipArchivedAt: string | null
  /** Identidade já excluída permanentemente (profiles.deleted_at) — global. */
  profileDeletedAt: string | null
  /**
   * Tem vínculo NÃO arquivado em outra academia (multi-vínculo). Excluir
   * anonimiza profiles, que é compartilhada entre academias — sem esta
   * checagem, a academia A apagaria em silêncio o cadastro de alguém ainda
   * ativo (matriculado, pagando) na academia B.
   */
  hasActiveMembershipElsewhere: boolean
}

export type PermanentDeleteVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Exige inativação NESTA academia antes de excluir: exclusão apaga a
 * identidade compartilhada entre academias (profiles), então a academia que
 * pede tem de já ter encerrado o próprio vínculo primeiro — evita um clique
 * único destruir o cadastro de alguém ainda ativo em turma/plano.
 */
export function canPermanentlyDelete(
  target: PermanentDeleteTarget,
  isSelf: boolean,
): PermanentDeleteVerdict {
  if (isSelf) return { ok: false, reason: 'Você não pode excluir o seu próprio cadastro.' }
  if (target.role !== 'student') {
    return { ok: false, reason: 'Só cadastro de aluno pode ser excluído permanentemente aqui.' }
  }
  if (target.profileDeletedAt) {
    return { ok: false, reason: 'Este cadastro já foi excluído permanentemente.' }
  }
  if (!target.membershipArchivedAt) {
    return { ok: false, reason: 'Inative o cadastro nesta academia antes de excluir permanentemente.' }
  }
  if (target.hasActiveMembershipElsewhere) {
    return {
      ok: false,
      reason: 'Este aluno ainda está ativo em outra academia. Peça para inativar lá antes de excluir permanentemente.',
    }
  }
  return { ok: true }
}
