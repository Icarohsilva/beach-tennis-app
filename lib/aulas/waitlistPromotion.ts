// lib/aulas/waitlistPromotion.ts
// Regras puras da entrada automática pela fila de espera. Sem I/O — quem lê o
// banco é features/aulas/waitlistActions.ts.
import { BOOKING_GRACE_MINUTES } from '@/lib/utils/creditRules'

/**
 * Quão perto do início a entrada automática deixa de acontecer.
 *
 * Colocar alguém na aula 10 minutos antes quase garante um ausente: a pessoa não
 * olha o celular em tempo, e o professor recebe a turma cheia no papel e vazia
 * na quadra. Dentro desta última hora a vaga simplesmente fica aberta e entra
 * quem quiser — que é o comportamento de sempre.
 *
 * Uma hora não é número solto: é a mesma janela de `BOOKING_GRACE_MINUTES`, o
 * tempo que o aluno tem para desistir sem penalidade depois de entrar. Abaixo
 * dela a entrada automática criaria uma reserva cuja saída sem custo já venceu
 * junto com a aula.
 */
export const AUTO_ENTRY_CUTOFF_HOURS = BOOKING_GRACE_MINUTES / 60

/**
 * Ainda dá tempo de colocar alguém automaticamente nesta aula?
 *
 * Falso também para aula que já começou ou já passou — a subtração fica
 * negativa e cai no mesmo lado da comparação.
 */
export function canAutoEnter(
  sessionStartIso: string,
  nowIso: string,
  cutoffHours = AUTO_ENTRY_CUTOFF_HOURS,
): boolean {
  const start = new Date(sessionStartIso).getTime()
  const now = new Date(nowIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(now)) return false
  return (start - now) / 3_600_000 >= cutoffHours
}

/**
 * Quantas vagas há para promover. Nunca negativo: turma com mais reservas que a
 * capacidade (capacidade reduzida depois das reservas) devolve 0, não um número
 * negativo que viraria laço às avessas.
 */
export function openSpots(capacity: number, confirmed: number): number {
  return Math.max(capacity - confirmed, 0)
}
