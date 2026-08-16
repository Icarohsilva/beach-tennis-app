// features/aulas/cycleClose.ts
// Fecha os ciclos de cota já encerrados, gravando o saldo que passa adiante.
//
// Existe porque acumular sem limite obriga a ter saldo gravado: a cota é
// derivada da janela do ciclo, e a janela de fevereiro não enxerga janeiro.
// Derivar recursivamente até o começo da história não tem base de parada.
//
// O que se grava é EXTRATO, não cache: cada linha guarda as parcelas que
// produziram o número (o que o plano deu, o que veio de antes, o que foi usado),
// então dá para responder "por que este aluno tem 5 aulas a mais" sem recalcular
// nada. E o `granted`/`used` vêm do MESMO `getQuotaSnapshot` que a tela usa —
// uma segunda implementação da regra da cota é como as duas divergem.
import type { createAdminClient } from '@/lib/supabase/server'
import { getQuotaSnapshot } from './quotaUsage'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { cycleWindow, nextCycleWindow, carryOut } from '@/lib/utils/classQuota'
import { brtToday } from '@/lib/utils/gridSchedule'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Quantos ciclos atrás se aceita fechar de uma vez, por aluno.
 *
 * Rede de segurança para dado torto (assinatura com data antiga, aluno que
 * voltou depois de um ano): sem teto, um único aluno faria o cron percorrer
 * centenas de ciclos e estourar o orçamento de tempo da função, travando o
 * fechamento de todo mundo.
 */
const MAX_CYCLES_PER_RUN = 18

export interface CycleCloseResult {
  studentsProcessed: number
  cyclesClosed: number
  failed: number
}

/**
 * Fecha os ciclos pendentes de UM aluno, do último fechado até o último já
 * encerrado.
 *
 * Idempotente: o `unique (student_id, organization_id, cycle_start)` da tabela
 * mais o `ignoreDuplicates` do upsert garantem que rodar duas vezes no mesmo dia
 * não dobre saldo de ninguém.
 */
export async function closeStudentCycles(
  client: AdminClient,
  studentId: string,
  orgId: string,
  today: string,
): Promise<number> {
  const plan = await getActivePlan(client, studentId, orgId)
  // Sem plano vigente não há o que acumular. E sem rollover o saldo nem é lido,
  // então gravar linha seria estado morto.
  if (!plan || !plan.rolloverUnused) return 0

  // De onde retomar: o ciclo seguinte ao último fechado. Sem nenhum fechado, o
  // ponto de partida é o ciclo atual — o histórico anterior à ativação do
  // rollover não vira saldo retroativo, o que seria presentear meses passados.
  const { data: lastRow } = await client
    .from('plan_cycle_balances')
    .select('cycle_start, cycle_end, carried_out')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .order('cycle_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  const last = lastRow as
    | { cycle_start: string; cycle_end: string; carried_out: number }
    | null

  const currentCycle = cycleWindow(today, plan.cycle)
  let window = last
    ? nextCycleWindow({ from: last.cycle_start, to: last.cycle_end }, plan.cycle)
    : currentCycle
  let carriedIn = last ? Math.max(0, last.carried_out) : 0

  let closed = 0
  for (let i = 0; i < MAX_CYCLES_PER_RUN; i++) {
    // Só fecha ciclo ENCERRADO. O ciclo em curso ainda vai receber reservas, e
    // fechá-lo cedo congelaria um saldo que ainda vai mudar.
    if (window.to >= currentCycle.from) break

    // A data alvo é o último dia do ciclo: getQuotaSnapshot deriva a janela dela.
    const snapshot = await getQuotaSnapshot(client, studentId, orgId, plan, window.to)
    const granted = Math.max(0, snapshot.limit - carriedIn)
    const out = carryOut({ carriedIn, granted, used: snapshot.used })

    const { error } = await client.from('plan_cycle_balances').upsert(
      {
        organization_id: orgId,
        student_id: studentId,
        cycle_start: window.from,
        cycle_end: window.to,
        granted,
        used: snapshot.used,
        carried_in: carriedIn,
        carried_out: out,
      },
      { onConflict: 'student_id,organization_id,cycle_start', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[cycleClose] upsert falhou', {
        studentId, orgId, cycleStart: window.from, error: error.message,
      })
      break
    }

    closed++
    carriedIn = out
    window = nextCycleWindow(window, plan.cycle)
  }

  return closed
}

/**
 * Alunos com assinatura ativa numa academia — os candidatos ao fechamento.
 *
 * O filtro fino (plano com rollover, período vigente) fica em
 * `closeStudentCycles`, que já busca o plano de qualquer jeito: repetir a
 * junção aqui só para pré-filtrar dobraria a consulta.
 */
export async function listCycleCloseCandidates(
  client: AdminClient,
  orgId?: string,
): Promise<{ studentId: string; orgId: string }[]> {
  let query = client
    .from('student_subscriptions')
    .select('student_id, organization_id')
    .eq('status', 'active')
  if (orgId) query = query.eq('organization_id', orgId)

  const { data } = await query
  return ((data ?? []) as { student_id: string; organization_id: string }[]).map((s) => ({
    studentId: s.student_id,
    orgId: s.organization_id,
  }))
}

/** `brtToday` embrulhado para o cron não precisar importar gridSchedule. */
export function todayBrt(): string {
  return brtToday(new Date())
}
