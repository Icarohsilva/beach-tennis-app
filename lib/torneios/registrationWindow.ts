// lib/torneios/registrationWindow.ts
// Quando a inscrição está mesmo aberta — status do torneio + prazo opcional
// (tournaments.registration_deadline, migração 20260826000500).
//
// A página e a action de inscrição têm de concordar aqui: se cada uma decidir
// "está aberto?" do próprio jeito, o botão aparece e a action recusa — ou o
// contrário, fecha a inscrição que a action ainda aceitaria.
import type { TournamentStatus } from '@/types'

export type RegistrationBlock = 'not_open' | 'deadline_passed'

export interface RegistrationWindow {
  open: boolean
  block: RegistrationBlock | null
  reason: string | null
}

const NOT_OPEN_REASON: Record<Exclude<TournamentStatus, 'open'>, string> = {
  draft: 'Este torneio ainda não abriu inscrições.',
  in_progress: 'Inscrições encerradas — o torneio já começou.',
  finished: 'Inscrições encerradas — o torneio já terminou.',
}

export function resolveRegistrationWindow(
  t: { status: TournamentStatus; registration_deadline: string | null },
  now: Date,
): RegistrationWindow {
  if (t.status !== 'open') {
    return { open: false, block: 'not_open', reason: NOT_OPEN_REASON[t.status] }
  }
  // Nulo = comportamento de hoje: só fecha por troca de status, sem prazo.
  if (t.registration_deadline && new Date(t.registration_deadline).getTime() <= now.getTime()) {
    return { open: false, block: 'deadline_passed', reason: 'Inscrições encerradas — o prazo passou.' }
  }
  return { open: true, block: null, reason: null }
}

/** 'Inscrições até sex, 22/08 às 23:59' — nulo quando não há prazo. */
export function deadlineLabel(deadline: string | null): string | null {
  if (!deadline) return null
  const formatted = new Date(deadline).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Inscrições até ${formatted}`
}

const CLOSING_SOON_WINDOW_MS = 48 * 60 * 60 * 1000

/** 'Fecha em 3h' para criar urgência no CTA. Nulo sem prazo, ou a mais de 48h. */
export function closingSoonLabel(deadline: string | null, now: Date): string | null {
  if (!deadline) return null
  const msLeft = new Date(deadline).getTime() - now.getTime()
  if (msLeft <= 0 || msLeft > CLOSING_SOON_WINDOW_MS) return null
  const hours = Math.floor(msLeft / (60 * 60 * 1000))
  if (hours >= 1) return `Fecha em ${hours}h`
  const minutes = Math.max(1, Math.floor(msLeft / (60 * 1000)))
  return `Fecha em ${minutes}min`
}
