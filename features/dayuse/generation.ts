// features/dayuse/generation.ts
// Materializa os moldes de dayuse_recurrences em linhas de dayuse_slots.
// Chamado pelo cron diário e pelo botão "Gerar agora" do admin.
//
// Idempotente por índice único (organization_id, court, date, start_time): a
// passada de amanhã encontra as datas de hoje já criadas e as pula.
//
// DIFERENÇA DELIBERADA em relação a generateGrid (features/aulas/gridGeneration.ts):
// aqui NÃO se reabre slot desativado. Na grade de aulas, reabrir era obrigatório
// porque o índice único não olha `status` e a aula cancelada ficava cancelada
// para sempre. No day use é o contrário: remover o slot de uma data é decisão
// explícita da academia (feriado, quadra em manutenção), e ressuscitá-lo na
// passada seguinte desfaria essa decisão toda madrugada.
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/supabase/paginate'
import { buildDayUseRows, type DayUseRecurrence } from '@/lib/dayuse/recurrence'
import { addDaysStr } from '@/lib/utils/gridSchedule'

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Dias à frente que a geração mantém no ar.
 *
 * Horizonte rolante: o cron roda todo dia e sempre estende até hoje+28, então a
 * agenda nunca "acaba" nem precisa de marca d'água como a grade de aulas
 * (grid_auto_last_run) — o upsert idempotente torna repetir inofensivo. 28 dias
 * porque day use é divulgado com semanas de antecedência no WhatsApp da arena.
 */
export const DAY_USE_HORIZON_DAYS = 28

/** A janela que o cron e o "Gerar agora" do admin usam: hoje..hoje+horizonte. */
export function dayUseWindow(today: string): { from: string; to: string } {
  return { from: today, to: addDaysStr(today, DAY_USE_HORIZON_DAYS) }
}

export interface GenerateDayUseResult {
  /** Slots efetivamente INSERIDOS nesta chamada (o upsert não devolve conflito). */
  slotsCreated: number
  /** Moldes ativos considerados. 0 = a academia não usa day use recorrente. */
  recurrences: number
  /** Presente quando o upsert falhou — o chamador não deve tratar como sucesso. */
  error?: string
}

interface RecurrenceRow extends DayUseRecurrence {
  created_by: string | null
}

/**
 * Gera os day use recorrentes da academia em [from, to] (yyyy-MM-dd, inclusivo).
 */
export async function generateDayUse(
  orgId: string,
  from: string,
  to: string,
  injectedClient?: AdminClient,
): Promise<GenerateDayUseResult> {
  const client = injectedClient ?? createAdminClient()

  const recurrences = await fetchAllPages<RecurrenceRow>(
    (a, b) =>
      client
        .from('dayuse_recurrences')
        .select('id, day_of_week, start_time, end_time, court, capacity, sport, kind, price_cents, payment_timing, notes, created_by')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(a, b) as unknown as Page<RecurrenceRow>,
    { label: 'dayuse/recorrencias' },
  )

  if (recurrences.length === 0) return { slotsCreated: 0, recurrences: 0 }

  const rows = buildDayUseRows(recurrences, from, to)
  if (rows.length === 0) return { slotsCreated: 0, recurrences: recurrences.length }

  // created_by vem do molde: o cron não tem usuário logado, e a coluna aponta
  // para quem é responsável por aquele day use existir.
  const authorOf = new Map(recurrences.map((r) => [r.id, r.created_by]))

  // organization_id explícito: dayuse_slots não tem o trigger trg_set_org (foi
  // removido no cutover de identidade, plano 3).
  const { data: inserted, error } = await client
    .from('dayuse_slots')
    .upsert(
      rows.map((r) => ({
        ...r,
        organization_id: orgId,
        created_by: authorOf.get(r.recurrence_id) ?? null,
        is_active: true,
      })),
      { onConflict: 'organization_id,court,date,start_time', ignoreDuplicates: true },
    )
    .select('id')

  if (error) {
    console.error('[generateDayUse] upsert de dayuse_slots falhou', {
      orgId, from, to, error: error.message,
    })
    return { slotsCreated: 0, recurrences: recurrences.length, error: error.message }
  }

  return { slotsCreated: inserted?.length ?? 0, recurrences: recurrences.length }
}
