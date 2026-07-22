// lib/utils/attendees.ts

export interface AttendeeRef {
  id: string
  name: string
}

interface MergeArgs {
  /** Reservas confirmadas desta sessão. */
  booked: AttendeeRef[]
  /** Alunos fixos da turma (matrícula ativa). */
  enrolled: AttendeeRef[]
  /** Ids de alunos com reserva `cancelled` nesta sessão — avisaram que não vêm. */
  optedOut: Set<string>
}

/**
 * Quem é esperado numa aula.
 *
 * As duas fontes são parciais e precisam ser somadas: o aluno fixo só ganha uma
 * `session_bookings` quando a reconciliação roda E ele está elegível (parceiro
 * ou plano vigente), então turmas convivem com fixos sem reserva. Tratar as
 * fontes como alternativas fazia a lista inteira ser trocada pela primeira
 * reserva criada — era o que sumia com os fixos assim que alguém entrava.
 *
 * Reserva confirmada vence: quem o banco diz que está dentro aparece, mesmo que
 * também conste como opt-out.
 */
export function mergeSessionAttendees({ booked, enrolled, optedOut }: MergeArgs): AttendeeRef[] {
  const byId = new Map<string, AttendeeRef>()

  for (const person of booked) byId.set(person.id, person)

  for (const person of enrolled) {
    if (byId.has(person.id) || optedOut.has(person.id)) continue
    byId.set(person.id, person)
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
