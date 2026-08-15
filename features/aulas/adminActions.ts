'use server'
// features/aulas/adminActions.ts — admin-only student management server actions

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { format, endOfMonth } from 'date-fns'
import type { AgeGroup, StudentLevel } from '@/types'
import { reconcileEnrollmentCredits } from './reconcileEnrollment'
import { getActivePlan, hasActiveSubscriptionPlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced, getOrgMaxClassesPerDay } from './quotaSettings'
import { computeQuotaBudget } from './quotaBudget'
import { getQuotaSnapshot } from './quotaUsage'
import { resolveClassAccess, exceedsDailyCap } from '@/lib/utils/accessRules'
import { getSingleClassPrice } from '@/features/financeiro/classDebt'
import type { AddStudentReason, CheckinPartner } from '@/types'
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { requireAdmin } from './authGuards'
import { brtToday } from '@/lib/utils/gridSchedule'
import { cancelFutureBookings } from './cancelBookings'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
} from '@/features/checkin/missedCheckinSettings'
import { isMissedCheckinBlocked } from '@/lib/checkin/missedCheckins'
import { normalizeSportsForOrg } from '@/lib/arenas/sports'
import { checkProfileComplete, revokeLigaExtra, ENTRY_REASONS } from '@/features/liga/extraPoints'
import { notifyWaitlistSpotOpen } from './waitlistActions'

// ---------------------------------------------------------------------------
// updateStudentLevel
// ---------------------------------------------------------------------------

export async function updateStudentLevel(
  studentId: string,
  level: StudentLevel,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  // Nível é por-academia: fonte é a membership da academia ativa.
  const { error } = await adminClient
    .from('memberships')
    .update({ level })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao atualizar nível.' }

  return {}
}

// ---------------------------------------------------------------------------
// updateStudentAgeGroup
// ---------------------------------------------------------------------------

// Adulto ou kids NESTA academia. Não restringe nada: alimenta o filtro da lista de
// alunos e o aviso de turma incompatível.
export async function updateStudentAgeGroup(
  studentId: string,
  ageGroup: AgeGroup,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (ageGroup !== 'adult' && ageGroup !== 'kids') return { error: 'Tipo de aluno inválido.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('memberships')
    .update({ age_group: ageGroup })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao atualizar o tipo de aluno.' }

  return {}
}

// ---------------------------------------------------------------------------
// updateStudentSports
// ---------------------------------------------------------------------------

// Esportes que o aluno pratica NESTA academia. Alimenta os rankings da Liga; não
// tem efeito nenhum sobre o que ele pode reservar.
export async function updateStudentSports(
  studentId: string,
  sports: string[],
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const { data: org } = await adminClient
    .from('organizations')
    .select('sports')
    .eq('id', orgId)
    .maybeSingle()

  const { error } = await adminClient
    .from('memberships')
    .update({ sports: normalizeSportsForOrg(sports, org?.sports ?? []) })
    .eq('user_id', studentId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao atualizar esportes.' }

  // Liga: o cadastro completo também pode ser fechado POR AQUI, quando é a academia
  // que preenche os dados do aluno. Sem esta chamada, quem tem a ficha preenchida
  // pela secretaria nunca ganharia o bônus — e o aluno não tem como saber por quê.
  await checkProfileComplete(adminClient, orgId, studentId)

  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
  return {}
}

// ---------------------------------------------------------------------------
// enrollStudentInClass  (fixed weekly enrollment)
// ---------------------------------------------------------------------------

export async function enrollStudentInClass(
  studentId: string,
  classId: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Check class exists and is active (escopado pela academia ativa)
  const { data: cls } = await adminClient
    .from('classes')
    .select('id, is_active, max_students')
    .eq('id', classId)
    .eq('organization_id', orgId)
    .single()

  if (!cls || !cls.is_active) return { error: 'Turma não encontrada ou inativa.' }

  // Fixa exige plano ou parceiro (spec §2). Crédito não compra vaga fixa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner, archived_at')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }

  const { partner, archived_at: archivedAt } = membership as {
    partner: string | null
    archived_at: string | null
  }

  // Inativar cancela as matrículas; dar uma nova sem reativar recriaria a vaga
  // recorrente de alguém que a academia tirou da operação.
  if (archivedAt) {
    return { error: 'O cadastro desse aluno está inativo. Reative na ficha dele antes de matricular.' }
  }

  if (!partner) {
    const hasActivePlan = await hasActiveSubscriptionPlan(adminClient, studentId, orgId)

    if (!hasActivePlan) {
      return {
        error:
          'Aula fixa exige plano ativo ou Wellhub/TotalPass. Para uma aula pontual, adicione o aluno direto na sessão.',
      }
    }
  }

  // Pendência de check-in barra a matrícula fixa SEM escape: matricular é dar uma
  // vaga recorrente ao aluno que já vem deixando a academia sem repasse. Para uma
  // aula pontual o admin ainda pode adicioná-lo direto na sessão, com force.
  if (partner) {
    const { blockLimit } = await getMissedCheckinSettings(adminClient, orgId)
    if (blockLimit > 0) {
      const abertas = await countOpenMissedCheckins(adminClient, studentId, orgId)
      if (isMissedCheckinBlocked(abertas, blockLimit)) {
        return {
          error: `Esse aluno tem ${abertas} pendência(s) de check-in em aberto e está bloqueado. Resolva em Controle Wellhub antes de matricular.`,
        }
      }
    }
  }

  // Cota: o plano define quantas turmas fixas o aluno pode ter. Sem isto o
  // admin vincula um plano de 2x/semana a cinco turmas sem nenhum aviso.
  // quotaEnforced/activePlanForQuota também alimentam o orçamento da
  // reconciliação logo abaixo — buscados uma vez só, reusados nos dois lugares.
  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const activePlanForQuota = quotaEnforced ? await getActivePlan(adminClient, studentId, orgId) : null

  if (quotaEnforced && activePlanForQuota) {
    const { data: activeRaw } = await adminClient
      .from('enrollments')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('organization_id', orgId)
      .eq('is_active', true)

    const jaTem = ((activeRaw ?? []) as { class_id: string }[]).filter(
      (e) => e.class_id !== classId,
    ).length

    if (jaTem + 1 > activePlanForQuota.classesPerWeek) {
      return {
        error: `O plano deste aluno dá ${activePlanForQuota.classesPerWeek} aulas fixas por semana e ele já tem ${jaTem}. Troque o plano ou remova uma turma fixa.`,
      }
    }
  }

  // Check for existing active enrollment
  const { count: existing } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('class_id', classId)
    .eq('is_active', true)

  if ((existing ?? 0) > 0) return { error: 'Aluno já está matriculado nesta turma.' }

  // Check capacity
  const { count: enrolled } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('is_active', true)

  if ((enrolled ?? 0) >= cls.max_students) return { error: 'Turma lotada.' }

  // Upsert handles re-enrollment of previously cancelled students
  const { error } = await adminClient.from('enrollments').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      class_id: classId,
      is_active: true,
      enrolled_at: new Date().toISOString(),
      cancelled_at: null,
    },
    { onConflict: 'student_id,class_id' },
  )

  if (error) return { error: `Erro ao criar matrícula: ${error.message}` }

  // Reserva as sessões restantes do mês para esta turma. Não consome crédito:
  // quem chega aqui tem plano ou parceiro (spec §3). Respeita a cota
  // compartilhada — orçamento calculado por computeQuotaBudget, a mesma
  // função usada por features/aulas/creditReconciliation.ts: sem isso,
  // matricular perto do fim do mês reservava tudo até o fim
  // incondicionalmente, ignorando quanto da cota mensal o aluno já tinha usado.
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  const partnerForBudget = (membership as { partner: string | null }).partner
  const quotaBudget = await computeQuotaBudget(
    adminClient, studentId, orgId, quotaEnforced, activePlanForQuota, partnerForBudget, today,
  )

  await reconcileEnrollmentCredits(studentId, classId, today, monthEnd, adminClient, quotaBudget)

  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
  return {}
}

// ---------------------------------------------------------------------------
// cancelEnrollment
// ---------------------------------------------------------------------------

/**
 * Cancela as reservas que a matrícula já tinha gerado para as aulas futuras da
 * turma, estornando o crédito de quem debitou.
 *
 * Sem isto, sair da turma deixa as reservas 'confirmed' para trás e o aluno
 * continua aparecendo na chamada para sempre: a grade monta o roster unindo
 * reservas confirmadas + matrículas ativas, e regerar não conserta (o upsert de
 * sessões é idempotente e reconcileEnrollmentCredits só adiciona, nunca remove).
 * Mesmo tratamento que deleteClass já dava ao excluir a turma inteira.
 */
async function cancelFutureEnrollmentBookings(
  adminClient: ReturnType<typeof createAdminClient>,
  enrollment: { student_id: string; class_id: string; organization_id: string },
): Promise<void> {
  await cancelFutureBookings(adminClient, {
    studentId: enrollment.student_id,
    orgId: enrollment.organization_id,
    classId: enrollment.class_id,
    onlyFromEnrollment: true,
    refundReason: 'Estorno: matrícula na turma encerrada',
  })
}

export async function cancelEnrollment(enrollmentId: string): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const now = new Date().toISOString()

  const { data: enrollmentData } = await adminClient
    .from('enrollments')
    .select('student_id, class_id, organization_id')
    .eq('id', enrollmentId)
    .single()

  const { error } = await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('id', enrollmentId)

  if (error) return { error: 'Erro ao cancelar matrícula.' }

  if (enrollmentData) {
    const enrollment = enrollmentData as {
      student_id: string
      class_id: string
      organization_id: string
    }
    await cancelFutureEnrollmentBookings(adminClient, enrollment)
    revalidatePath(`/admin/alunos/${enrollment.student_id}`)
  }
  revalidatePath('/admin/alunos')
  revalidatePath('/admin/grade')
  return {}
}

// ---------------------------------------------------------------------------
// addDependentSelf — guardian adds their own dependent (no admin required)
// ---------------------------------------------------------------------------

export async function addDependentSelf(
  name: string,
  level: StudentLevel,
): Promise<{ dependentId?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!name.trim()) return { error: 'Nome é obrigatório.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()

  // is_dependent é por-academia: verifica via membership da academia ativa.
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('is_dependent')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (!callerMembership) return { error: 'Você não participa desta academia.' }
  if (callerMembership.is_dependent) return { error: 'Dependentes não podem adicionar dependentes.' }

  const newId = crypto.randomUUID()

  // Identidade do dependente (profiles = só identidade). Campos por-academia vão
  // na membership abaixo.
  const { data: newDep, error } = await adminClient
    .from('profiles')
    .insert({
      id: newId,
      full_name: name.trim(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[addDependentSelf] profiles.insert', error)
    return { error: 'Erro ao criar dependente.' }
  }

  // Membership do dependente na academia ativa (fonte da verdade por-academia).
  const { error: memErr } = await adminClient.from('memberships').insert({
    user_id: newId,
    organization_id: orgId,
    role: 'student',
    level,
    is_dependent: true,
    parent_id: user.id,
    payment_type: 'subscriber',
    credits_balance: 0,
    contract_active: false,
  })

  if (memErr) {
    console.error('[addDependentSelf] memberships.insert', memErr)
    return { error: 'Erro ao criar dependente.' }
  }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/perfil')

  return { dependentId: (newDep as { id: string }).id }
}

// ---------------------------------------------------------------------------
// addDependent — creates a new student profile linked to this parent
// ---------------------------------------------------------------------------

export async function addDependent(
  parentId: string,
  fullName: string,
  level: StudentLevel,
): Promise<{ dependentId?: string; error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (!fullName.trim()) return { error: 'Nome é obrigatório.' }

  const adminClient = createAdminClient()

  // Responsável precisa ser membro desta academia e não ser dependente (por-academia).
  const { data: parentMembership } = await adminClient
    .from('memberships')
    .select('is_dependent')
    .eq('user_id', parentId)
    .eq('organization_id', orgId)
    .single()

  if (!parentMembership) return { error: 'Responsável não encontrado nesta academia.' }
  if (parentMembership.is_dependent) return { error: 'Dependentes não podem ter dependentes.' }

  const newId = crypto.randomUUID()

  // Identidade do dependente (profiles = só identidade; sem auth user — gerido pelo
  // responsável). Campos por-academia vão na membership abaixo.
  const { error } = await adminClient.from('profiles').insert({
    id: newId,
    full_name: fullName.trim(),
  })

  if (error) {
    console.error('[addDependent] profiles.insert', error)
    return { error: 'Erro ao criar dependente.' }
  }

  // Membership do dependente na academia do admin (fonte da verdade por-academia).
  const { error: memErr } = await adminClient.from('memberships').insert({
    user_id: newId,
    organization_id: orgId,
    role: 'student',
    level,
    is_dependent: true,
    parent_id: parentId,
    payment_type: 'subscriber',
    contract_active: true,
    credits_balance: 0,
  })

  if (memErr) {
    console.error('[addDependent] memberships.insert', memErr)
    return { error: 'Erro ao criar dependente.' }
  }

  // A ficha do responsável lista os dependentes com link para a ficha de cada um;
  // sem revalidar, o dependente novo só aparece (com o id de verdade) no próximo
  // carregamento completo. `newId` volta para o cliente pelo mesmo motivo: o
  // append otimista precisa do id real para montar um link que funcione.
  revalidatePath(`/admin/alunos/${parentId}`)
  revalidatePath('/admin/alunos')

  return { dependentId: newId }
}

// ---------------------------------------------------------------------------
// deleteClass — soft-delete a class and cancel all associated data
// ---------------------------------------------------------------------------

export async function deleteClass(classId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const now = new Date().toISOString()
  const today = format(new Date(), 'yyyy-MM-dd')

  // Garante que a turma pertence à academia ativa antes de mutar. Pega o nome
  // para a mensagem da notificação.
  const { data: ownClass } = await adminClient
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .eq('organization_id', orgId)
    .single()
  if (!ownClass) return { error: 'Turma não encontrada.' }

  // Coleta destinatários afetados ANTES de cancelar — as mutações abaixo mudam
  // os filtros (status='confirmed', is_active=true) que identificam os afetados.
  const { data: futureSessions } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('class_id', classId)
    .gte('session_date', today)
  const sessionIds = (futureSessions ?? []).map((s: { id: string }) => s.id)

  const affectedIds = new Set<string>()
  if (sessionIds.length > 0) {
    const { data: bookingsRaw } = await adminClient
      .from('session_bookings')
      .select('student_id')
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
    for (const b of (bookingsRaw ?? []) as { student_id: string }[]) affectedIds.add(b.student_id)
  }
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true)
  for (const e of (enrollmentsRaw ?? []) as { student_id: string }[]) affectedIds.add(e.student_id)

  // Cancel all future sessions
  await adminClient
    .from('class_sessions')
    .update({ status: 'cancelled' })
    .eq('class_id', classId)
    .gte('session_date', today)
    .neq('status', 'cancelled')

  // Cancel bookings on those future sessions
  if (sessionIds.length > 0) {
    await adminClient
      .from('session_bookings')
      .update({ status: 'cancelled', cancelled_at: now })
      .in('session_id', sessionIds)
      .eq('status', 'confirmed')
  }

  // Cancel all active enrollments
  await adminClient
    .from('enrollments')
    .update({ is_active: false, cancelled_at: now })
    .eq('class_id', classId)
    .eq('is_active', true)

  // Soft-delete the class
  const { error } = await adminClient
    .from('classes')
    .update({ is_active: false })
    .eq('id', classId)

  if (error) return { error: 'Erro ao excluir turma.' }

  // Best-effort: notificar afetados NUNCA reverte o cancelamento.
  if (affectedIds.size > 0) {
    try {
      const ids = Array.from(affectedIds)
      const { data: emailRows } = await adminClient
        .from('user_emails')
        .select('id, email')
        .in('id', ids)
      const { data: profileRows } = await adminClient
        .from('profiles')
        .select('id, phone')
        .in('id', ids)
      const emailById = new Map(((emailRows ?? []) as { id: string; email: string }[]).map((r) => [r.id, r.email]))
      const phoneById = new Map(((profileRows ?? []) as { id: string; phone: string | null }[]).map((r) => [r.id, r.phone]))

      await notifyUsers(adminClient, {
        orgId,
        recipients: ids.map((id) => ({
          userId: id,
          email: emailById.get(id) ?? null,
          phone: phoneById.get(id) ?? null,
        })),
        type: 'class_cancelled',
        title: 'Aula cancelada',
        body: `A turma "${(ownClass as { name: string }).name}" foi cancelada.`,
        channels: ['inapp', 'email', 'whatsapp', 'push'],
      })
    } catch (err) {
      console.error('[deleteClass] notifyUsers falhou', {
        classId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, {
        tags: { channel: 'dispatch', notificationType: 'class_cancelled' },
        extra: { classId, orgId },
      })
    }
  }

  revalidatePath('/admin/grade')
  revalidatePath('/admin/alunos')
  return {}
}

// ---------------------------------------------------------------------------
// addCreditsManually — admin adds credits to any student (any amount, any reason)
// ---------------------------------------------------------------------------

export async function addCreditsManually(
  studentId: string,
  amount: number,
  reason: string,
): Promise<{ error?: string }> {
  const { error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (!Number.isInteger(amount) || amount === 0) {
    return { error: 'Quantidade inválida.' }
  }

  const adminClient = createAdminClient()

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { error: creditErr } = await adminClient.rpc('adjust_credits', {
    p_student_id: studentId,
    p_org: orgId,
    p_delta: amount,
    p_type: amount > 0 ? 'renewed' : 'expired',
    p_reason: reason.trim() || (amount > 0 ? 'Créditos adicionados pelo admin' : 'Créditos removidos pelo admin'),
  })

  if (creditErr) {
    if (creditErr.message.includes('STUDENT_NOT_FOUND')) return { error: 'Aluno não encontrado.' }
    if (creditErr.message.includes('INSUFFICIENT_CREDITS')) return { error: 'Saldo insuficiente para remover essa quantidade.' }
    return { error: 'Erro ao registrar transação.' }
  }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// addStudentToSession — admin/professor adiciona aluno avulso a uma sessão
// ---------------------------------------------------------------------------

/**
 * Adiciona um aluno a uma sessão, com ou sem crédito, plano ou parceiro.
 *
 * IGNORA o bloqueio por dívida de propósito (spec §1): o admin pode estar
 * adicionando justamente o aluno que está quitando no balcão. Esta é a única
 * porta com essa permissão.
 *
 * `reason` só é considerado quando o aluno não tem plano, parceiro nem crédito;
 * caso contrário o caminho normal decide (parceiro/plano entram de graça,
 * crédito debita).
 */
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
  reason: AddStudentReason,
  force = false,
): Promise<{
  error?: string
  quotaBlocked?: boolean
  missedBlocked?: boolean
  /** Turma no limite: o professor pode repetir com force para exceder. */
  fullBlocked?: boolean
}> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, session_date, class:classes(max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if ((session as { status: string }).status !== 'scheduled') {
    return { error: 'Esta sessão não está disponível.' }
  }
  const sessionDate = (session as { session_date: string }).session_date

  const clsRaw = (session as { class: { max_students: number } | { max_students: number }[] }).class
  const cls = Array.isArray(clsRaw) ? clsRaw[0] : clsRaw

  const { data: membership } = await adminClient
    .from('memberships')
    .select('partner, credits_balance, archived_at')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!membership) return { error: 'Aluno não participa desta academia.' }
  const mem = membership as {
    partner: string | null
    credits_balance: number
    archived_at: string | null
  }

  // Cadastro inativo é bloqueio DURO, antes do `force`. O force existe para o
  // professor furar capacidade e cota conscientemente; furar a inativação apagaria o
  // significado dela pelas costas de quem inativou. Quem precisa do aluno em aula
  // reativa o cadastro — é um clique na ficha.
  if (mem.archived_at) {
    return { error: 'O cadastro desse aluno está inativo. Reative na ficha dele para colocá-lo em aula.' }
  }

  const plan = await getActivePlan(adminClient, studentId, orgId)
  const hasActivePlan = plan !== null

  // Dívida continua sempre furada pelo admin (hasOpenDebt: false) — isso não
  // muda. Cota e teto diário agora valem de verdade; com force: true o admin
  // fura especificamente essa negação.
  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)

  // Teto diário vale pra todo mundo, ligado ou não à cota do plano — mesmo
  // mecanismo de bookSession (features/aulas/actions.ts). Sem isto, um aluno
  // sem plano ativo nunca esbarra em limite nenhum aqui, porque o eixo de
  // cota do resolveClassAccess só olha bookingsOnDate quando há plano.
  // 0 = sem teto (exceedsDailyCap). Com teto desligado nem a contagem do dia
  // precisa rodar — é uma query por adição de aluno.
  const dailyCap = plan?.maxClassesPerDay ?? orgDailyCap

  if (dailyCap > 0 && !force) {
    const { count: dailyCount } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .in(
        'session_id',
        (
          await adminClient
            .from('class_sessions')
            .select('id')
            .eq('organization_id', orgId)
            .eq('session_date', sessionDate)
        ).data?.map((s: { id: string }) => s.id) ?? [],
      )

    if (exceedsDailyCap(dailyCount ?? 0, dailyCap)) {
      return {
        error: `Esse aluno já tem ${dailyCap} aulas neste dia. É o limite do plano dele.`,
        quotaBlocked: true,
      }
    }
  }

  const snapshot =
    quotaEnforced && plan
      ? await getQuotaSnapshot(adminClient, studentId, orgId, plan, sessionDate)
      : null

  // Pendência de check-in: ao contrário da dívida, esta o admin VÊ. Faz diferença
  // saber que o aluno está devendo check-in justamente na hora de colocá-lo na aula.
  // O force existente também fura esta negação — o admin decide.
  const { blockLimit: missedCheckinBlockLimit } = mem.partner
    ? await getMissedCheckinSettings(adminClient, orgId)
    : { blockLimit: 0 }
  const openMissedCheckins =
    mem.partner && missedCheckinBlockLimit > 0
      ? await countOpenMissedCheckins(adminClient, studentId, orgId)
      : 0

  const decision = resolveClassAccess({
    // Já barrado acima com mensagem própria; aqui é só para satisfazer o tipo.
    archived: false,
    partner: mem.partner as CheckinPartner | null,
    hasActivePlan,
    creditsBalance: mem.credits_balance,
    hasOpenDebt: false,
    openMissedCheckins,
    missedCheckinBlockLimit,
    quotaEnforced,
    quotaRemaining: snapshot?.remaining ?? null,
    bookingsOnDate: snapshot?.bookingsOnDate ?? 0,
    maxClassesPerDay: dailyCap,
    // O admin não escolhe forma de pagamento: quem decide é a precedência normal
    // (plano antes de crédito). Para furar limite ele tem o `force`.
    preferCredit: false,
  })

  if ('denied' in decision) {
    // 'blocked_by_debt' nunca aparece aqui (hasOpenDebt é sempre false). O caso
    // 'daily_cap' já é barrado acima pelo check universal antes de chegar aqui —
    // isto só é alcançável de fato via force: true (redundância inofensiva).
    if (!force) {
      if (decision.denied === 'blocked_by_missed_checkins') {
        return {
          error: `Esse aluno tem ${openMissedCheckins} pendência(s) de check-in em aberto.`,
          missedBlocked: true,
        }
      }
      const message =
        decision.denied === 'daily_cap'
          ? `Esse aluno já tem ${dailyCap} aulas neste dia. É o limite do plano dele.`
          : `Esse aluno já usou toda a cota do plano ${plan?.cycle === 'weekly' ? 'desta semana' : 'deste mês'}.`
      return { error: message, quotaBlocked: true }
    }
    // force: true — segue o fluxo normal abaixo, sem grant (não debita crédito).
  }

  const useCredit = 'grant' in decision && decision.grant === 'credit'

  // Capacidade: com force o professor passa do limite da turma de propósito.
  // Ele precisa disso porque uma falta não devolve a vaga para o aluno seguinte
  // — sem poder exceder, uma turma cheia de faltosos ficaria bloqueada. O teto
  // vira Infinity via um número alto; a RPC continua atômica quanto ao resto.
  const capacity = force ? Number.MAX_SAFE_INTEGER : cls.max_students

  const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_max_students: capacity,
    p_type: 'extra',
    p_from_enrollment: false,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) {
      return { error: 'Esta turma está lotada.', fullBlocked: true }
    }
    if (bookErr.message.includes('ALREADY_BOOKED')) return { error: 'Aluno já está nesta aula.' }
    return { error: 'Erro ao adicionar o aluno.' }
  }

  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: -1,
      p_type: 'used',
      p_reason: 'Adicionado à aula pelo admin',
      p_session_id: sessionId,
    })
    if (creditErr) {
      const { error: rollbackErr } = await adminClient
        .from('session_bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('session_id', sessionId)

      if (rollbackErr) {
        console.error('[addStudentToSession] rollback do booking falhou após erro no débito', {
          studentId,
          sessionId,
          creditErr: creditErr.message,
          rollbackErr: rollbackErr.message,
        })
      }

      return { error: 'Erro ao debitar o crédito. Tente novamente.' }
    }
  }

  // Pré-declaração. Só para quem não tem plano/parceiro/crédito — para os outros
  // a aula já está paga e gravar payments aqui seria cobrança dupla.
  if ('grant' in decision && decision.grant === 'debt' && reason !== 'open') {
    const price = await getSingleClassPrice(adminClient, orgId)

    const { error: payErr } = await adminClient.from('payments').insert({
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      amount: reason === 'experimental' ? 0 : price,
      currency: 'BRL',
      status: 'paid',
      type: reason === 'experimental' ? 'trial' : 'per_class',
      gateway: 'manual',
      paid_at: new Date().toISOString(),
      credits_qty: null,
    })

    // 23505 = já havia pendência para este par: a aula já estava registrada.
    // Não é erro — e não derruba a reserva, que é o que o admin pediu.
    if (payErr && payErr.code !== '23505') {
      console.error('[addStudentToSession] pre-declaracao falhou', {
        sessionId, studentId, reason, error: payErr.message,
      })
    }
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}

// ---------------------------------------------------------------------------
// startClass — abre a chamada e dá presença a quem já tem check-in
// ---------------------------------------------------------------------------

/**
 * Marca a aula como iniciada e registra presença automática para quem já tem
 * check-in do dia (parceiro Wellhub/TotalPass ou confirmação validada no app).
 *
 * Antes disto a chamada é só leitura: presença e falta só passam a valer depois
 * que o professor inicia a aula, para não haver falta registrada em aula que
 * ainda nem começou. Idempotente — reiniciar não duplica presença nem
 * sobrescreve o que o professor já ajustou na mão.
 */
export async function startClass(
  sessionId: string,
): Promise<{ error?: string; autoPresent?: number }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, started_at, status')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!session) return { error: 'Sessão não encontrada.' }
  if ((session as { status: string }).status === 'cancelled') {
    return { error: 'Esta aula foi cancelada.' }
  }

  const sessionDate = (session as { session_date: string }).session_date

  if (!(session as { started_at: string | null }).started_at) {
    const { error: startErr } = await adminClient
      .from('class_sessions')
      .update({ started_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('organization_id', orgId)
    if (startErr) return { error: 'Erro ao iniciar a aula. Tente novamente.' }
  }

  // Quem está na aula: reservas confirmadas + fixos que não avisaram falta.
  const { data: bookingRows } = await adminClient
    .from('session_bookings')
    .select('student_id, status')
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .in('status', ['confirmed', 'cancelled'])

  const rows = (bookingRows ?? []) as { student_id: string; status: string }[]
  const expected = new Set(rows.filter((b) => b.status === 'confirmed').map((b) => b.student_id))

  // Check-ins do dia (parceiro) e confirmações validadas pelo app. Ambos são
  // presença de fato — o professor não deveria ter que remarcar na mão.
  const [{ data: checkinRows }, { data: selfRows }] = await Promise.all([
    adminClient
      .from('checkins')
      .select('student_id')
      .eq('organization_id', orgId)
      .eq('checkin_date', sessionDate),
    adminClient
      .from('self_checkins')
      .select('student_id')
      .eq('organization_id', orgId)
      .eq('session_id', sessionId)
      .eq('status', 'validated'),
  ])

  const checkedIn = new Set<string>()
  for (const c of (checkinRows ?? []) as { student_id: string }[]) {
    if (expected.has(c.student_id)) checkedIn.add(c.student_id)
  }
  for (const s of (selfRows ?? []) as { student_id: string }[]) {
    if (expected.has(s.student_id)) checkedIn.add(s.student_id)
  }

  if (checkedIn.size === 0) {
    revalidatePath(`/admin/grade/${sessionId}`)
    return { autoPresent: 0 }
  }

  // Não sobrescreve presença já registrada (ignoreDuplicates): se o professor
  // ou o webhook do parceiro já marcou, aquela marcação continua valendo.
  const { error: attErr } = await adminClient.from('attendance').upsert(
    Array.from(checkedIn).map((studentId) => ({
      organization_id: orgId,
      session_id: sessionId,
      student_id: studentId,
      status: 'present',
      source: 'manual',
    })),
    { onConflict: 'session_id,student_id', ignoreDuplicates: true },
  )
  if (attErr) {
    console.error('[startClass] presença automática falhou', {
      sessionId, error: attErr.message,
    })
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  return { autoPresent: checkedIn.size }
}

// ---------------------------------------------------------------------------
// removeStudentFromSession — tira o aluno SÓ desta aula
// ---------------------------------------------------------------------------

/**
 * Remove o aluno desta sessão (e só dela: a matrícula fixa e as outras datas
 * continuam intactas), registrando a falta e liberando a vaga.
 *
 * `giveBack` é a escolha do professor no diálogo de confirmação, e ela vale
 * para todo tipo de aluno — o que muda é a moeda em que a aula é devolvida:
 *   - quem pagou com crédito → o crédito volta para o saldo;
 *   - quem é de plano ou parceiro → a aula não entra na contagem do ciclo
 *     (admin_waived), ficando disponível para ele usar em outro dia.
 *
 * Com `giveBack: false` a aula é consumida nas duas moedas: nada é estornado e
 * a reserva conta na cota como cancelamento em cima da hora.
 */
export async function removeStudentFromSession(
  sessionId: string,
  studentId: string,
  giveBack: boolean,
): Promise<{ error?: string; refunded?: boolean; quotaWaived?: boolean }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, class_id, class:classes(sport)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!session) return { error: 'Sessão não encontrada.' }

  const removeClsRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const removeSport = (removeClsRaw as { sport: string | null } | null)?.sport ?? null

  const { data: existingBooking } = await adminClient
    .from('session_bookings')
    .select('status, credit_used, from_enrollment')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const booking = existingBooking as
    | { status: string; credit_used: boolean; from_enrollment: boolean }
    | null

  // Só devolve o que foi de fato consumido nesta data.
  const hasCreditToRefund = booking?.status === 'confirmed' && booking?.credit_used === true

  // Reserva 'cancelled' (unique student_id,session_id) marca a falta E impede a
  // reconciliação de re-reservar o aluno nesta data. from_enrollment preservado:
  // o fixo continua fixo, só não vem NESTA aula.
  const { error: upsertErr } = await adminClient.from('session_bookings').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      status: 'cancelled',
      from_enrollment: booking?.from_enrollment ?? true,
      credit_used: false,
      cancelled_at: new Date().toISOString(),
      // Isenta a aula da cota do ciclo. É o "devolver" de quem não tem crédito:
      // sem isto a remoção perto do horário contaria como aula usada.
      admin_waived: giveBack,
    },
    { onConflict: 'student_id,session_id' },
  )
  if (upsertErr) return { error: `Erro ao remover o aluno: ${upsertErr.message}` }

  // Falta explícita na chamada — o professor tirou o aluno da aula, então a
  // ausência fica registrada mesmo que a aula ainda não tenha sido iniciada.
  const { error: attErr } = await adminClient.from('attendance').upsert(
    {
      organization_id: orgId,
      session_id: sessionId,
      student_id: studentId,
      status: 'absent',
      source: 'manual',
    },
    { onConflict: 'session_id,student_id' },
  )
  if (attErr) {
    console.error('[removeStudentFromSession] falha ao registrar falta', {
      sessionId, studentId, error: attErr.message,
    })
  }

  let refunded = false
  if (giveBack && hasCreditToRefund) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: 1,
      p_type: 'refunded',
      p_reason: 'Removido da aula pelo professor: crédito devolvido',
      p_session_id: sessionId,
    })
    if (creditErr) {
      console.error('[removeStudentFromSession] adjust_credits falhou', {
        studentId, sessionId, error: creditErr.message,
      })
      return { error: 'Aluno removido, mas houve um erro ao devolver o crédito. Contate o suporte.' }
    }
    refunded = true
  }

  // Vaga liberada: avisa a fila de espera desta sessão.
  await notifyWaitlistSpotOpen(sessionId)

  // Liga: o aluno saiu da aula, então o ponto de ter entrado com antecedência (ou
  // de ter pego vaga na fila) deixa de valer. Mesma simetria das saídas do aluno.
  for (const reason of ENTRY_REASONS) {
    await revokeLigaExtra(adminClient, {
      orgId,
      studentId,
      reason,
      sourceId: sessionId,
      sport: removeSport,
    })
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  revalidatePath('/admin/grade')
  return { refunded, quotaWaived: giveBack }
}

// ---------------------------------------------------------------------------
// adminSkipEnrollmentDate / adminUnskipEnrollmentDate
// ---------------------------------------------------------------------------

/** Admin tira o aluno de UMA data (falta pontual): reserva 'cancelled' na sessão. */
export async function adminSkipEnrollmentDate(
  studentId: string,
  sessionId: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()

  // Escopo: a sessão é desta academia. Guarda class_id para revalidar também
  // a página de edição da turma (Task 10), como updateClass já faz.
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, class_id')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!session) return { error: 'Sessão não encontrada.' }

  // Mesma checagem de addStudentToSession: aluno precisa participar desta academia.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Aluno não participa desta academia.' }

  // Lê a reserva ANTES do upsert: se já havia uma reserva 'confirmed' com
  // crédito debitado (ex.: addStudentToSession usou 1 crédito para esta data),
  // o upsert abaixo vai sobrescrevê-la para 'cancelled'/credit_used:false —
  // sem isto o crédito se perderia sem estorno. Mesma lógica de
  // skipEnrollmentSession (features/aulas/actions.ts).
  const { data: existingBooking } = await adminClient
    .from('session_bookings')
    .select('status, credit_used')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  const needsRefund = existingBooking?.status === 'confirmed' && existingBooking?.credit_used === true

  // Reserva 'cancelled' (unique student_id,session_id): a reconciliação não
  // re-reserva quem tem QUALQUER reserva na sessão (creditReconciliation).
  const { error } = await adminClient.from('session_bookings').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      status: 'cancelled',
      from_enrollment: true,
      credit_used: false,
      cancelled_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id' },
  )
  if (error) return { error: `Erro ao registrar falta: ${error.message}` }

  let creditWarning: string | undefined
  if (needsRefund) {
    // Crédito de reposição sem vencimento — mesmo tratamento de skipEnrollmentSession.
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: 1,
      p_type: 'refunded',
      p_reason: 'Falta pontual registrada pelo admin: crédito reposição sem vencimento',
      p_session_id: sessionId,
    })
    if (creditErr) {
      console.error('[adminSkipEnrollmentDate] adjust_credits falhou', {
        studentId, sessionId, error: creditErr.message,
      })
      creditWarning = 'Falta registrada, mas houve um erro ao devolver o crédito. Contate o suporte.'
    }
  }

  revalidatePath('/admin/grade')
  revalidatePath(`/admin/grade/${session.class_id}/editar`, 'page')
  return creditWarning ? { error: creditWarning } : {}
}

/** Desfaz a falta: remove a reserva 'cancelled' daquela data (volta a poder reservar). */
export async function adminUnskipEnrollmentDate(
  studentId: string,
  sessionId: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  const adminClient = createAdminClient()

  // Só para revalidar a página de edição da turma (Task 10) além da listagem;
  // não precisa bloquear o desfazer se a turma não for encontrada.
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('class_id')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const { error } = await adminClient
    .from('session_bookings')
    .delete()
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .eq('status', 'cancelled')
  if (error) return { error: `Erro ao desfazer: ${error.message}` }

  revalidatePath('/admin/grade')
  if (session) revalidatePath(`/admin/grade/${session.class_id}/editar`, 'page')
  return {}
}

// ---------------------------------------------------------------------------
// updateSessionOverride / cancelSession — editar UMA data
// ---------------------------------------------------------------------------

/**
 * Muda horário, quadra ou lotação de UMA data, sem tocar na turma.
 *
 * Existe porque a aula gerada era imutável: remarcar a terça significava mudar a
 * turma e, com ela, todas as terças seguintes. Na prática a academia cancelava a
 * data e avisava por WhatsApp — o app ficava com o horário errado.
 *
 * Campo nulo = "volta a herdar a turma", que é como o botão de desfazer funciona.
 * A validação de par de horários e de lotação positiva também está no banco
 * (CHECK em 20260815000000_class_session_overrides.sql); aqui ela existe para dar
 * mensagem em português em vez de erro de constraint.
 */
export async function updateSessionOverride(
  sessionId: string,
  patch: {
    start_time: string | null
    end_time: string | null
    court: number | null
    max_students: number | null
  },
): Promise<{ error?: string; warning?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, class:classes(name, start_time, end_time, court, max_students)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!session) return { error: 'Aula não encontrada.' }

  const hasStart = !!patch.start_time
  const hasEnd = !!patch.end_time
  if (hasStart !== hasEnd) {
    return { error: 'Informe o horário de início E de fim, ou deixe os dois em branco.' }
  }
  if (hasStart && patch.end_time! <= patch.start_time!) {
    return { error: 'O fim da aula tem de ser depois do início.' }
  }
  if (patch.max_students !== null && patch.max_students < 1) {
    return { error: 'A lotação da aula tem de ser pelo menos 1.' }
  }
  if (patch.court !== null && patch.court < 1) {
    return { error: 'A quadra tem de ser um número positivo.' }
  }

  const { error: updateErr } = await adminClient
    .from('class_sessions')
    .update({
      start_time: patch.start_time,
      end_time: patch.end_time,
      court: patch.court,
      max_students: patch.max_students,
    })
    .eq('id', sessionId)
    .eq('organization_id', orgId)

  if (updateErr) return { error: `Erro ao salvar: ${updateErr.message}` }

  // Reduzir a lotação abaixo de quem já reservou AVISA e não corta ninguém: tirar
  // aluno de aula é decisão do professor, com estorno, e tem tela própria
  // (removeStudentFromSession). Fazer isso em silêncio aqui seria pior que o
  // excesso de lotação de um dia.
  let warning: string | undefined
  if (patch.max_students !== null) {
    const { count } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'confirmed')
    if ((count ?? 0) > patch.max_students) {
      warning = `Esta aula já tem ${count} alunos reservados, acima da nova lotação de ${patch.max_students}. Ninguém foi removido — tire quem precisar pela chamada.`
    }
  }

  // Vaga pode ter aberto (lotação aumentada): avisa a fila de espera.
  await notifyWaitlistSpotOpen(sessionId)

  revalidatePath(`/admin/grade/${sessionId}`)
  revalidatePath('/admin/grade')
  revalidatePath('/home')
  return warning ? { warning } : {}
}

/**
 * Cancela (ou reabre) UMA data.
 *
 * Cancelar a data não mexe nas reservas: a aula não aconteceu, então ninguém
 * levou falta e ninguém perdeu crédito — quem tinha reserva continua com ela e,
 * se a academia reabrir o dia, volta tudo como estava. O que muda é que a sessão
 * sai da agenda do aluno e ninguém mais entra.
 */
export async function setSessionCancelled(
  sessionId: string,
  cancelled: boolean,
  reason?: string | null,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, status, session_date, class:classes(name)')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!session) return { error: 'Aula não encontrada.' }

  // Aula já encerrada tem chamada feita: reabrir ou cancelar reescreveria um
  // fato passado, e presença/pendência já foram gravadas em cima dela.
  if ((session as { status: string }).status === 'completed') {
    return { error: 'Esta aula já foi encerrada. Não dá para cancelar depois da chamada.' }
  }

  const { error: updateErr } = await adminClient
    .from('class_sessions')
    .update({
      status: cancelled ? 'cancelled' : 'scheduled',
      cancelled_reason: cancelled ? (reason?.trim() || null) : null,
    })
    .eq('id', sessionId)
    .eq('organization_id', orgId)

  if (updateErr) return { error: `Erro ao salvar: ${updateErr.message}` }

  // Avisar quem tinha reserva é a razão de o motivo existir: a aula cancelada
  // some da agenda do aluno (só sessões 'scheduled' aparecem), então sem a
  // notificação ele descobriria na quadra. Best-effort — a aula já está
  // cancelada e uma falha de envio não pode desfazer isso.
  try {
    const { data: bookedRaw } = await adminClient
      .from('session_bookings')
      .select('student_id')
      .eq('session_id', sessionId)
      .eq('status', 'confirmed')

    const studentIds = ((bookedRaw ?? []) as { student_id: string }[]).map((b) => b.student_id)
    if (studentIds.length > 0) {
      const clsRaw = Array.isArray(session.class) ? session.class[0] : session.class
      const className = (clsRaw as { name: string } | null)?.name ?? 'sua aula'
      const sessionDate = (session as { session_date: string }).session_date
      const motivo = reason?.trim()

      await notifyUsers(adminClient, {
        orgId,
        recipients: studentIds.map((id) => ({ userId: id })),
        type: 'class_cancelled',
        title: cancelled ? 'Aula cancelada' : 'Aula reaberta',
        body: cancelled
          ? `A aula de ${className} do dia ${sessionDate} foi cancelada.${motivo ? ` Motivo: ${motivo}.` : ''} Você não perdeu crédito nem levou falta.`
          : `A aula de ${className} do dia ${sessionDate} voltou a acontecer. Sua reserva continua valendo.`,
        channels: ['inapp', 'push'],
      })
    }
  } catch (err) {
    console.error('[setSessionCancelled] notifyUsers falhou', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'class_cancelled' },
      extra: { sessionId },
    })
  }

  revalidatePath(`/admin/grade/${sessionId}`)
  revalidatePath('/admin/grade')
  revalidatePath('/home')
  return {}
}
