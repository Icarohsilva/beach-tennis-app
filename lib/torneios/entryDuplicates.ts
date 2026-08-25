// lib/torneios/entryDuplicates.ts
// Uma pessoa, no máximo uma dupla por torneio.
//
// O unique (tournament_id, player_id) de tournament_entries não garante isso:
// partner_id é a outra porta. B pode ser parceiro de A e, ao mesmo tempo, ter
// inscrição própria com C — duas linhas, nenhuma violação, e B entra na chave
// em dois pares. A migração 20260826000200 traz o trigger/índice que fecha a
// porta no banco; este módulo é a checagem ANTES do insert, para devolver
// mensagem legível em vez de erro de constraint.
export interface ExistingEntry {
  player_id: string
  partner_id: string | null
}

export interface PersonRef {
  id: string
  name?: string | null
}

export interface EntrantClash {
  person: PersonRef
  isMe: boolean
  asPartner: boolean
}

/**
 * A primeira pessoa desta nova inscrição que JÁ aparece em qualquer lado de
 * qualquer inscrição existente. `people` deve vir com "eu" primeiro, para a
 * mensagem falar do meu problema quando eu e o parceiro esbarram ao mesmo
 * tempo.
 */
export function findEntrantClash(
  existing: readonly ExistingEntry[],
  people: readonly PersonRef[],
  meId: string,
): EntrantClash | null {
  for (const person of people) {
    for (const entry of existing) {
      if (entry.player_id === person.id) {
        return { person, isMe: person.id === meId, asPartner: false }
      }
      if (entry.partner_id === person.id) {
        return { person, isMe: person.id === meId, asPartner: true }
      }
    }
  }
  return null
}

export function clashMessage(clash: EntrantClash): string {
  const who = clash.isMe ? 'Você' : clash.person.name?.trim() || 'Este jogador'
  const suffix = clash.asPartner ? ', como parceiro de outra dupla' : ''
  return `${who} já está inscrito neste torneio${suffix}.`
}

/** Auto-dupla. Nulo quando está tudo bem. */
export function selfPairError(playerId: string, partnerId: string | null | undefined): string | null {
  if (partnerId && partnerId === playerId) {
    return 'Você não pode ser seu próprio parceiro.'
  }
  return null
}
