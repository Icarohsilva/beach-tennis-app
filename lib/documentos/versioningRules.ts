// lib/documentos/versioningRules.ts
// Regras puras de edição de um org_document já publicado.
//
// Toda edição cria uma versão NOVA (o texto de cada versão é imutável — ver a
// migração). A escolha do admin ("correção" × "mudança de conteúdo") não decide
// SE existe versão nova, decide só se os acks da versão anterior são
// recriados na nova (quem já leu/assinou continua valendo) ou não (todo mundo
// volta a aparecer como pendente).
export type DocStatus = 'draft' | 'published' | 'archived'
export type EditMode = 'correction' | 'content_change'

/**
 * Só publicado com gente já tendo confirmado a versão corrente exige a
 * escolha do admin — documento em rascunho, ou publicado sem ninguém ainda
 * ter confirmado, pode ganhar versão nova sem perguntar nada (não há o que
 * preservar nem ninguém para "voltar a bloquear").
 */
export function requiresEditModeChoice(status: DocStatus, ackCountAtCurrentVersion: number): boolean {
  return status === 'published' && ackCountAtCurrentVersion > 0
}

export interface ExistingAck {
  userId: string
  signedName: string | null
  signedCpf: string | null
  coveredDependents: unknown
  ipAddress: string | null
  userAgent: string | null
  ackedAt: string
}

/**
 * Quais acks da versão anterior devem ser recriados na versão nova.
 * 'correction': todos — a prova original de quem confirmou continua valendo,
 * mesmo que o texto tenha sido só corrigido (typo, formatação).
 * 'content_change': nenhum — o conteúdo mudou de verdade, então até quem já
 * tinha confirmado a versão anterior volta a aparecer como pendente.
 */
export function carryForwardAcks(mode: EditMode, previousAcks: ExistingAck[]): ExistingAck[] {
  return mode === 'correction' ? previousAcks : []
}
