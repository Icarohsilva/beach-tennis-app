// app/api/cron/complete-past-sessions/route.ts
// Fecha (`scheduled` -> `completed`) toda sessão de uma data que já passou.
//
// Até 2026-08 isto era um clique: o professor confirmava a chamada
// (markAttendanceBulk) e SÓ NESSE MOMENTO a sessão virava 'completed'. A
// chamada em si deixou de exigir esse clique — o professor já marca
// presença/falta a qualquer momento em AttendanceSheet, sem precisar "iniciar"
// nem "confirmar" nada — então precisava de outro jeito de fechar a sessão,
// senão os quatro pontos que dependem de 'completed' (setSessionCancelled
// recusando cancelar, SessionOverrideForm escondendo o formulário de editar a
// data, addStudentToSession recusando matrícula avulsa, e a confirmação de
// presença pelo app recusando novo envio) ficariam destravados para sempre em
// qualquer aula passada.
//
// Não precisa de fetchAllPages/mapWithConcurrency como os outros crons que
// varrem a base: aqueles processam linha a linha (RPC, notificação, cálculo
// por aluno); este é um único UPDATE por predicado — o Postgres resolve
// quantas linhas baterem o filtro numa instrução só, sem paginação nem
// orçamento de tempo.
//
// `session_date < hoje`, não uma comparação de horário: mesma régua de
// attendanceReport.ts e pendingClassesFor. Rodando de madrugada, o dia
// anterior inteiro (mesmo a aula das 23h) já ficou para trás, então não há
// necessidade de considerar hora — e não completar o dia corrente evita
// qualquer atrito com a janela de confirmação de presença pelo app (1h antes
// do início até 1h depois do fim), que nunca ultrapassa o próprio dia.
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { brtToday } from '@/lib/utils/gridSchedule'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const today = brtToday(new Date())

    const { data, error } = await admin
      .from('class_sessions')
      .update({ status: 'completed' })
      .eq('status', 'scheduled')
      .lt('session_date', today)
      .select('id')

    if (error) throw new Error(error.message)

    return NextResponse.json({ completed: data?.length ?? 0 })
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'complete-past-sessions' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
