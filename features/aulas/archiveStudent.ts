'use server'
// features/aulas/archiveStudent.ts
// Exclusão lógica do aluno numa academia — tipicamente um dependente que saiu.
//
// Nada é apagado: `attendance`, `credit_transactions` e `liga_points` apontam para o
// profile, e o histórico do que já aconteceu não muda porque a pessoa saiu. O que
// muda é a operação DAQUI PARA FRENTE: o aluno sai das listas, libera a vaga fixa,
// perde as reservas futuras (com estorno) e a assinatura é encerrada.
//
// Encerrar a assinatura é parte da ação, não um passo separado que o admin lembre de
// fazer: sem isso o responsável continuaria sendo cobrado por uma criança que já não
// treina. O diálogo de confirmação diz exatamente isso antes de executar.
//
// Crédito NÃO é zerado. É valor que o responsável pagou; enquanto o cadastro está
// inativo o crédito fica inerte (o aluno não aparece em nenhuma tela de reserva), e
// se a academia reativar ele continua lá. Zerar seria destruir valor por um clique
// reversível.
import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from './authGuards'
import { cancelFutureBookings } from './cancelBookings'
import { adminCancelStudentPlan } from '@/features/financeiro/actions'

export interface ArchiveStudentResult {
  error?: string
  /** Matrículas fixas encerradas. */
  enrollmentsCancelled?: number
  /** Reservas futuras canceladas (crédito estornado). */
  bookingsCancelled?: number
  /** Havia assinatura ativa e ela foi encerrada. */
  planCancelled?: boolean
}

/**
 * Inativa o cadastro do aluno na academia ativa.
 *
 * Ordem importa: libera turma e reservas ANTES de marcar `archived_at`. Se a
 * passada falhar no meio, o pior estado é um aluno ainda ativo com a vaga já
 * liberada — recuperável repetindo a ação. Na ordem inversa o pior estado seria um
 * aluno invisível ocupando vaga numa turma, que ninguém consegue achar para
 * consertar.
 */
export async function archiveStudent(studentId: string): Promise<ArchiveStudentResult> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role, archived_at, is_dependent')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não encontrado nesta academia.' }

  const target = membership as { role: string; archived_at: string | null; is_dependent: boolean }
  if (target.role !== 'student') {
    // Inativar professor/admin por aqui esconderia alguém que ainda tem acesso de
    // gestão. Equipe sai pela tela de Equipe, que mexe no papel.
    return { error: 'Só cadastro de aluno pode ser inativado aqui. Use Equipe para professor ou admin.' }
  }
  if (target.archived_at) return { error: 'Este cadastro já está inativo.' }
  if (studentId === userId) return { error: 'Você não pode inativar o seu próprio cadastro.' }

  const now = new Date().toISOString()

  // 1. Matrículas fixas: libera a vaga recorrente na turma.
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const enrollmentIds = ((enrollmentsRaw ?? []) as { id: string }[]).map((e) => e.id)
  if (enrollmentIds.length > 0) {
    const { error: enrollErr } = await adminClient
      .from('enrollments')
      .update({ is_active: false, cancelled_at: now })
      .in('id', enrollmentIds)
    if (enrollErr) {
      console.error('[archiveStudent] enrollments.update', enrollErr)
      return { error: 'Erro ao encerrar as matrículas do aluno.' }
    }
  }

  // 2. Reservas futuras, com estorno. `onlyFromEnrollment: false` porque o objetivo
  // é liberar TODA vaga que ele ocupava — inclusive avulsa/reposição.
  const { cancelled: bookingsCancelled } = await cancelFutureBookings(adminClient, {
    studentId,
    orgId,
    onlyFromEnrollment: false,
    refundReason: 'Cadastro inativado na academia',
  })

  // 3. Assinatura ativa, via adminCancelStudentPlan — NÃO por update direto na
  // tabela. A assinatura pode estar no Mercado Pago, e aquela função cancela a
  // preapproval lá antes de mexer no banco, abortando se o MP recusar. Um update
  // local deixaria a linha como `cancelled` enquanto o MP seguisse cobrando o
  // responsável todo mês — exatamente o dano que encerrar o plano existe para evitar.
  //
  // `clearCredits: false`: crédito é valor pago, e a inativação é reversível.
  const { data: subRow } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .maybeSingle()

  const hadPlan = Boolean(subRow)
  if (hadPlan) {
    const { error: planErr } = await adminCancelStudentPlan(studentId, false)
    // Aborta sem marcar `archived_at`: melhor o aluno continuar visível com o plano
    // vivo do que invisível com o cartão do responsável sendo debitado.
    if (planErr) return { error: `Não foi possível encerrar a assinatura: ${planErr}` }
  }

  // 4. Só agora o cadastro sai das listas.
  const { error: archiveErr } = await adminClient
    .from('memberships')
    .update({ archived_at: now })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (archiveErr) {
    console.error('[archiveStudent] memberships.update', archiveErr)
    return { error: 'Erro ao inativar o cadastro.' }
  }

  revalidateStudentPaths(studentId)

  return {
    enrollmentsCancelled: enrollmentIds.length,
    bookingsCancelled,
    planCancelled: hadPlan,
  }
}

/**
 * Reativa o cadastro.
 *
 * Devolve só a visibilidade: turma e plano NÃO voltam. Restaurar matrícula fixa
 * automaticamente colocaria o aluno numa turma que pode ter lotado no meio-tempo, e
 * ressuscitar assinatura significaria voltar a cobrar sem alguém decidir isso. O
 * admin rematricula e reassina pela própria ficha, com as regras de vaga e de cota
 * valendo normalmente.
 */
export async function reactivateStudent(studentId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role, archived_at')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não encontrado nesta academia.' }
  const target = membership as { role: string; archived_at: string | null }
  if (target.role !== 'student') return { error: 'Só cadastro de aluno pode ser reativado aqui.' }
  if (!target.archived_at) return { error: 'Este cadastro já está ativo.' }

  const { error } = await adminClient
    .from('memberships')
    .update({ archived_at: null })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[reactivateStudent] memberships.update', error)
    return { error: 'Erro ao reativar o cadastro.' }
  }

  revalidateStudentPaths(studentId)
  return {}
}

function revalidateStudentPaths(studentId: string) {
  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
  revalidatePath('/admin/grade')
  // A lista de dependentes do responsável vive no /perfil dele.
  revalidatePath('/perfil')
}
