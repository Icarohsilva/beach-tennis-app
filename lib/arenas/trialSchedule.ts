// lib/arenas/trialSchedule.ts
// A grade que o visitante vê para marcar a aula experimental: as MESMAS sessões
// geradas para a semana da academia (class_sessions), agrupadas por dia, no
// horário daquela data e com a vaga ou o "Lotado" de cada uma.
//
// Antes a vitrine escondia a aula lotada (o visitante via uma grade com buracos,
// diferente da que os alunos veem) e ordenava pelo horário da TURMA dentro do
// embed do PostgREST, que não ordena as linhas de fora: os horários do mesmo dia
// saíam embaralhados. Puro para ser testado; a busca está em lib/arenas/sessions.ts.
import type { Gender } from '@/types'
import { resolveSession, type SessionOverrides } from '@/lib/aulas/sessionOverride'
import { sessionStartIso } from '@/lib/utils/sessionTime'

export interface TrialSessionRow extends SessionOverrides {
  id: string
  session_date: string
  status: string
  class: {
    name: string
    level: string
    type: string
    start_time: string
    end_time: string
    max_students: number
    court?: number | null
    is_active: boolean
    gender_restriction: Gender | null
  } | null
}

export interface TrialSlot {
  id: string
  date: string
  className: string
  level: string
  startTime: string
  endTime: string
  /** Vagas que sobram. 0 = lotada (continua na lista, só não dá para marcar). */
  spotsLeft: number
  full: boolean
  genderRestriction: Gender | null
}

export interface TrialDay {
  date: string
  slots: TrialSlot[]
}

/**
 * Monta a grade da experimental.
 *
 * Fica de fora só o que o visitante não poderia marcar nunca: aula cancelada,
 * turma inativa, turma kids (a experimental é de adulto: não há responsável no
 * formulário) e aula que já começou. Lotada FICA, marcada como lotada: é a mesma
 * grade que o aluno vê, e sumir com ela fazia parecer que a academia não tinha
 * aula naquele horário.
 *
 * `occupied` conta as reservas confirmadas e as experimentais antigas, que não
 * têm reserva (ver getTrialSchedule).
 */
export function buildTrialSchedule(
  rows: TrialSessionRow[],
  occupied: Map<string, number>,
  now: Date,
): TrialDay[] {
  const slots: TrialSlot[] = []
  for (const s of rows) {
    const cls = s.class
    if (s.status !== 'scheduled' || !cls || !cls.is_active || cls.type === 'kids') continue
    const horario = resolveSession(s, cls)
    if (new Date(sessionStartIso(s.session_date, horario.startTime)).getTime() <= now.getTime()) continue
    const spotsLeft = Math.max(0, horario.maxStudents - (occupied.get(s.id) ?? 0))
    slots.push({
      id: s.id,
      date: s.session_date,
      className: cls.name,
      level: cls.level,
      startTime: horario.startTime,
      endTime: horario.endTime,
      spotsLeft,
      full: spotsLeft === 0,
      genderRestriction: cls.gender_restriction ?? null,
    })
  }

  slots.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.className.localeCompare(b.className, 'pt-BR'),
  )

  const days: TrialDay[] = []
  for (const slot of slots) {
    const last = days[days.length - 1]
    if (last && last.date === slot.date) last.slots.push(slot)
    else days.push({ date: slot.date, slots: [slot] })
  }
  return days
}

/** Tem pelo menos um horário com vaga? Sem nenhum, a tela troca o formulário por um aviso. */
export function hasOpenSlot(days: TrialDay[]): boolean {
  return days.some((d) => d.slots.some((s) => !s.full))
}
