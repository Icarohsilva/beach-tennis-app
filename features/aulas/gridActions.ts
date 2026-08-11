// features/aulas/gridActions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { getClassRoster, type Roster } from './enrollmentRoster'
import { notifyGridGenerated } from './gridNotify'
import { brtToday, addDaysStr, nextDateForDayOfWeek } from '@/lib/utils/gridSchedule'

interface GridActionResult {
  error?: string
  sessionsCreated?: number
  // reservados/aConfirmar/semPlano/semCota ficam em pt-BR de propósito: são o
  // shape direto do texto exibido ao admin, diferente do inglês interno de
  // enrollmentRoster.ts.
  reservados?: number
  aConfirmar?: number
  semPlano?: number
  semCota?: number
  comPendenciaCheckin?: number
}

/**
 * Busca o roster com blindagem: se falhar (qualquer uma das queries internas,
 * ou até createAdminClient()), degrada para contagens zeradas em vez de
 * derrubar a Server Action. Importante: generateGrid já inseriu as sessões de
 * forma durável ANTES deste ponto, e o gate de notificação (sessionsCreated >
 * 0) depende de um upsert idempotente — se a action rejeitar aqui, um retry
 * encontra as sessões já existentes, sessionsCreated volta 0, e a notificação
 * daquelas sessões específicas NUNCA mais dispara. Perder o roster não deveria
 * também bloquear o push.
 */
async function getRosterSafe(orgId: string, opts: { dayOfWeek?: number } = {}): Promise<Roster> {
  try {
    return await getClassRoster(createAdminClient(), orgId, opts)
  } catch (err) {
    console.error('[gridActions] getClassRoster falhou', { orgId, error: err instanceof Error ? err.message : String(err) })
    return { byClass: new Map(), totals: { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0 } }
  }
}

/** Roster (blindado) + notify (best-effort, gated) + revalidate + shape do retorno — cauda compartilhada pelas duas actions. */
async function finishGeneration(
  orgId: string,
  sessionsCreated: number,
  quotaSkipped: number,
  missedCheckinSkipped: number,
  rosterOpts: { dayOfWeek?: number },
  notifyScope: { kind: 'week' } | { kind: 'day'; dayOfWeek: number },
): Promise<GridActionResult> {
  const roster = await getRosterSafe(orgId, rosterOpts)
  if (sessionsCreated > 0) await notifyGridGenerated(orgId, notifyScope)

  revalidatePath('/admin/grade')
  // O calendário do painel mostra o "gerei / não gerei" e precisa refletir o
  // botão que o admin acabou de apertar.
  revalidatePath('/admin/dashboard')
  return {
    sessionsCreated,
    reservados: roster.totals.eligible,
    aConfirmar: roster.totals.pendingConfirmation,
    semPlano: roster.totals.noPlan,
    semCota: quotaSkipped,
    comPendenciaCheckin: missedCheckinSkipped,
  }
}

/** Gera a próxima ocorrência de um dia-da-semana (todas as turmas do dia). */
export async function generateGridDay(dayOfWeek: number): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: 'Dia inválido.' }
  }

  const today = brtToday(new Date())
  const target = nextDateForDayOfWeek(today, dayOfWeek)
  const r = await generateGrid(orgId, target, target, { dayOfWeek })
  if (r.error) return { error: r.error }

  return finishGeneration(
    orgId, r.sessionsCreated, r.quotaSkipped, r.missedCheckinSkipped,
    { dayOfWeek }, { kind: 'day', dayOfWeek },
  )
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Gera UMA data específica (todas as turmas do dia da semana dela).
 *
 * É o que o calendário do painel dispara: lá o admin aponta para o dia 27, não
 * para "a próxima terça". `generateGridDay` não serve porque sempre resolve
 * para a ocorrência mais próxima — apertar no dia 27 geraria o dia 13.
 */
export async function generateGridDate(dateISO: string): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  if (!DATE_RE.test(dateISO)) return { error: 'Data inválida.' }
  // Gerar o passado cria sessão para aula que já aconteceu e dispara o push de
  // "já dá pra agendar" para um dia que não existe mais.
  if (dateISO < brtToday(new Date())) return { error: 'Não dá para gerar grade de um dia que já passou.' }

  const dayOfWeek = new Date(`${dateISO}T12:00:00Z`).getUTCDay()
  const r = await generateGrid(orgId, dateISO, dateISO)
  if (r.error) return { error: r.error }

  return finishGeneration(
    orgId, r.sessionsCreated, r.quotaSkipped, r.missedCheckinSkipped,
    { dayOfWeek }, { kind: 'day', dayOfWeek },
  )
}

/** Gera a semana toda (7 datas a partir de hoje, todas as turmas). */
export async function generateGridWeek(): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  const from = brtToday(new Date())
  const to = addDaysStr(from, 6)
  const r = await generateGrid(orgId, from, to)
  if (r.error) return { error: r.error }

  return finishGeneration(
    orgId, r.sessionsCreated, r.quotaSkipped, r.missedCheckinSkipped,
    {}, { kind: 'week' },
  )
}
