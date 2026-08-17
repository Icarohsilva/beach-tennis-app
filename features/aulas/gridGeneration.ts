// features/aulas/gridGeneration.ts
// Núcleo ÚNICO de geração semanal da grade. Chamado por: criar turma, botão
// "gerar dia", botão "gerar semana", botão "gerar aula" da turma e o cron de
// auto-geração. Gera as sessões (idempotente) e reserva os alunos fixos elegíveis.
//
// Gerar tem DUAS metades, e por muito tempo só a primeira existia:
//
//   1. criar a sessão que falta — o upsert com `ignoreDuplicates`;
//   2. reabrir a sessão que foi cancelada — o update logo abaixo.
//
// A segunda existe porque o teste de existência da primeira é o índice único
// (class_id, session_date), e índice não olha `status`. Sessão cancelada era
// conflito, era pulada, e ficava cancelada para sempre: quem cancelasse a aula
// esperando que a geração a reconstruísse esperava sentado.
import { createAdminClient } from '@/lib/supabase/server'
import { chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import { buildSessionRows } from './sessionUtils'
import { reconcileAllActiveEnrollments } from './creditReconciliation'
import { restoreSessionBookings } from './reopenSessionBookings'

type AdminClient = ReturnType<typeof createAdminClient>

/** Resultado neutro — usado nas saídas antecipadas e no erro de upsert. */
const EMPTY = {
  sessionsCreated: 0,
  sessionsReopened: 0,
  studentsBooked: 0,
  quotaSkipped: 0,
  missedCheckinSkipped: 0,
} as const

export interface GenerateGridResult {
  /**
   * Sessões efetivamente INSERIDAS nesta chamada — não conta as que já existiam
   * e foram puladas pelo upsert idempotente, nem as reabertas (essas têm campo
   * próprio). É o que libera o push de "a grade está no ar", que só faz sentido
   * para aula que passou a existir agora.
   */
  sessionsCreated: number
  /**
   * Sessões que estavam canceladas e voltaram a `scheduled` nesta chamada.
   *
   * Separado de `sessionsCreated` porque o público é outro: quem precisa saber
   * de uma aula reaberta são os alunos daquela aula, que já receberam o aviso de
   * cancelamento — não a academia inteira.
   */
  sessionsReopened: number
  studentsBooked: number
  /** Alunos fixos que ficaram sem vínculo nesta rodada por falta de cota. */
  quotaSkipped: number
  /** Alunos fixos que ficaram sem vínculo por pendência de check-in em aberto. */
  missedCheckinSkipped: number
  /** Presente quando o upsert de class_sessions falhou — chamador não deve tratar como sucesso. */
  error?: string
}

/**
 * Gera as sessões das turmas ativas da org no intervalo [from, to] e reserva os
 * fixos. `opts.dayOfWeek` restringe às turmas daquele dia; `opts.classId` a uma
 * turma.
 *
 * Idempotente nas duas metades: o upsert com `ignoreDuplicates` não duplica
 * sessão existente, e a reabertura só toca em quem está `cancelled` — rodar duas
 * vezes seguidas não muda nada na segunda.
 */
export async function generateGrid(
  orgId: string,
  from: string, // yyyy-MM-dd
  to: string, // yyyy-MM-dd
  opts: { dayOfWeek?: number; classId?: string } = {},
  injectedClient?: AdminClient,
): Promise<GenerateGridResult> {
  const client = injectedClient ?? createAdminClient()

  let q = client
    .from('classes')
    .select('id, day_of_week')
    .eq('organization_id', orgId)
    .eq('is_active', true)
  if (opts.dayOfWeek !== undefined) q = q.eq('day_of_week', opts.dayOfWeek)
  if (opts.classId !== undefined) q = q.eq('id', opts.classId)

  const { data: classesRaw } = await q
  const classes = (classesRaw ?? []) as { id: string; day_of_week: number }[]
  if (classes.length === 0) return EMPTY

  const rows = classes.flatMap((c) => buildSessionRows(c.id, c.day_of_week, from, to))
  let sessionsCreated = 0
  let sessionsReopened = 0
  if (rows.length > 0) {
    // organization_id é preenchido pelo trigger trg_set_org (deriva de class_id).
    // .select() com ignoreDuplicates devolve SÓ as linhas inseridas (conflitos
    // são pulados e não voltam) → contagem real de sessões novas, não tentadas.
    const { data: inserted, error: upsertErr } = await client
      .from('class_sessions')
      .upsert(rows, { onConflict: 'class_id,session_date', ignoreDuplicates: true })
      .select('id')

    if (upsertErr) {
      console.error('[generateGrid] upsert de class_sessions falhou', {
        orgId, from, to, error: upsertErr.message,
      })
      return { ...EMPTY, error: upsertErr.message }
    }
    sessionsCreated = inserted?.length ?? 0

    const reopened = await reopenCancelledSessions(client, orgId, rows)
    sessionsReopened = reopened.length

    // Devolve as reservas que o cancelamento tirou, ANTES da reconciliação: é
    // ela que re-reserva os fixos, e ela só reserva quem não tem reserva
    // nenhuma na sessão.
    if (reopened.length > 0) {
      await restoreSessionBookings(client, { sessionIds: reopened, orgId })
    }
  }

  const rec = await reconcileAllActiveEnrollments(from, to, orgId)

  return {
    sessionsCreated,
    sessionsReopened,
    studentsBooked: rec.booked,
    quotaSkipped: rec.quotaSkipped,
    missedCheckinSkipped: rec.missedCheckinSkipped,
  }
}

/**
 * Volta para `scheduled` as sessões canceladas que a geração acabou de cobrir.
 *
 * Recebe as MESMAS linhas do upsert, e não um intervalo de datas, porque essa
 * lista é a definição de "sessão que deveria existir": ela já é o produto de
 * (turma ativa no escopo × datas do dia da semana dela). Duas consequências que
 * são o ponto todo desta função:
 *
 * - aula de turma **excluída** não ressuscita. `deleteClass` cancela as futuras e
 *   faz `is_active = false`; a turma sai da consulta lá em cima, então não está
 *   nas linhas, então não é reaberta. Sem isso, "Gerar semana" desfaria a
 *   exclusão de uma turma.
 * - aula de uma data que não bate mais com o dia da turma (a turma mudou de
 *   terça para quarta) também não volta: aquela data não é mais gerada.
 *
 * `.eq('status', 'cancelled')` é a terceira trava, e a mais importante: aula
 * `completed` tem chamada feita e presença gravada em cima dela. Reabrir
 * reescreveria um fato passado.
 *
 * Agrupa por data para não fazer uma consulta por turma: numa janela de 7 dias
 * são no máximo 7 updates, independentemente do tamanho da academia.
 */
async function reopenCancelledSessions(
  client: AdminClient,
  orgId: string,
  rows: { class_id: string; session_date: string }[],
): Promise<string[]> {
  const classIdsByDate = new Map<string, string[]>()
  for (const r of rows) {
    const list = classIdsByDate.get(r.session_date)
    if (list) list.push(r.class_id)
    else classIdsByDate.set(r.session_date, [r.class_id])
  }

  const reopened: string[] = []

  for (const [date, classIds] of Array.from(classIdsByDate.entries())) {
    // chunk porque a lista de ids vai na URL do PostgREST.
    for (const ids of chunk(classIds, IN_CHUNK_SIZE)) {
      const { data, error } = await client
        .from('class_sessions')
        .update({ status: 'scheduled', cancelled_reason: null })
        .eq('organization_id', orgId)
        .eq('session_date', date)
        .in('class_id', ids)
        .eq('status', 'cancelled')
        .select('id')

      if (error) {
        // Não derruba a geração: as sessões novas já estão gravadas, e a
        // reabertura é retentável na próxima passada (é idempotente).
        console.error('[generateGrid] reabertura de sessões falhou', {
          orgId, date, error: error.message,
        })
        continue
      }

      for (const s of (data ?? []) as { id: string }[]) reopened.push(s.id)
    }
  }

  return reopened
}
