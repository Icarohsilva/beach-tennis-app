'use server'
// app/arenas/[slug]/actions.ts
// Aula experimental marcada pela vitrine da arena. Escopada por organization_id
// para isolar academias.
//
// A experimental cria ACESSO: quem não está logado ganha conta no app e vínculo
// de aluno na academia, sem plano. A aula vira uma reserva normal
// (session_bookings), por isso aparece na chamada e na agenda dela, e a linha em
// trial_bookings guarda o CPF (uma experimental por CPF por academia) e a tag que
// a chamada mostra. Depois da experimental vale a regra de quem não tem plano:
// pagar depois, ou só com plano/crédito, conforme a academia configurou.
import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient, getAuthUser } from '@/lib/supabase/server'
import { resolveSession } from '@/lib/aulas/sessionOverride'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { canEnterByGender, classGenderDenialMessage } from '@/lib/aulas/classGenderRule'
import {
  parseNewTrialAccount,
  parseTrialCpf,
  TRIAL_CPF_USED_MESSAGE,
  type NewTrialAccountInput,
} from '@/lib/arenas/trialForm'
import type { Gender } from '@/types'

export interface TrialBookingInput extends NewTrialAccountInput {
  organizationId: string
  sessionId: string
  cpf: string
}

export type TrialBookingResult =
  | { error: string; loginRequired?: boolean }
  | { success: true; createdAccount: boolean }

type ClassRow = {
  name: string
  type: string
  is_active: boolean
  gender_restriction: Gender | null
  start_time: string
  end_time: string
  max_students: number
  court: number | null
}

export async function createTrialBooking(input: TrialBookingInput): Promise<TrialBookingResult> {
  const { organizationId, sessionId } = input

  const cpfParsed = parseTrialCpf(input.cpf)
  if (!cpfParsed.ok) return { error: cpfParsed.error }
  const cpf = cpfParsed.cpf

  const user = await getAuthUser()
  const account = user ? null : parseNewTrialAccount(input)
  if (account && !account.ok) return { error: account.error }
  const newAccount = account?.ok ? account.value : null

  const admin = createAdminClient()

  // Sessão precisa existir E pertencer a esta academia.
  const { data: session } = await admin
    .from('class_sessions')
    .select(
      'id, session_date, status, start_time, end_time, court, max_students, class:classes(name, type, is_active, gender_restriction, start_time, end_time, max_students, court)',
    )
    .eq('id', sessionId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!session) return { error: 'Aula não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta aula não está mais disponível.' }
  const cls = (Array.isArray(session.class) ? session.class[0] : session.class) as ClassRow | null
  if (!cls?.is_active) return { error: 'Esta turma não está mais ativa.' }
  if (cls.type === 'kids') return { error: 'Aula experimental disponível apenas para adultos.' }
  const horario = resolveSession(session, cls)
  if (new Date(sessionStartIso(session.session_date, horario.startTime)).getTime() <= Date.now()) {
    return { error: 'Esta aula já começou. Escolha outro horário.' }
  }

  // Quem já tem conta: o perfil manda no sexo; quem está criando, o formulário.
  type ProfileRow = { full_name: string | null; phone: string | null; gender: Gender | null }
  const profile: ProfileRow | null = user
    ? (((await admin.from('profiles').select('full_name, phone, gender').eq('id', user.id).maybeSingle())
        .data as ProfileRow | null) ?? null)
    : null
  const gender: Gender | null = newAccount?.gender ?? profile?.gender ?? null
  if (!canEnterByGender(gender, cls.gender_restriction)) {
    return { error: classGenderDenialMessage(cls.gender_restriction as Gender, gender !== null) }
  }

  // Uma experimental por pessoa: pelo CPF, pela conta e pelo e-mail (as antigas,
  // de antes do CPF, só têm o e-mail). Cancelada não conta.
  const email = (newAccount?.email ?? user?.email ?? '').toLowerCase()
  const { count: cpfUsed } = await admin
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .neq('status', 'cancelled')
    .or(
      // Aspas no e-mail: vírgula e parêntese são sintaxe do filtro `or` do PostgREST.
      [`cpf.eq.${cpf}`, email ? `email.eq."${email.replace(/"/g, '')}"` : null, user ? `student_id.eq.${user.id}` : null]
        .filter(Boolean)
        .join(','),
    )
  if ((cpfUsed ?? 0) > 0) return { error: TRIAL_CPF_USED_MESSAGE }

  if (user) {
    // Quem já fez aula aqui não é visitante: a experimental é para conhecer a academia.
    const { count: history } = await admin
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
    if ((history ?? 0) > 0) {
      return { error: 'Você já faz aulas nesta academia, então a experimental não se aplica. Agende pelo app.' }
    }
  }

  // Experimental antiga não tem reserva e ocupa vaga por fora da RPC: desconta do
  // teto que vai para ela, senão a turma passaria do limite.
  const { count: legacyTrials } = await admin
    .from('trial_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .is('student_id', null)
    .in('status', ['pending', 'attended'])
  const capacity = horario.maxStudents - (legacyTrials ?? 0)
  const { count: confirmed } = await admin
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')
  if ((confirmed ?? 0) >= capacity) return { error: 'Esta aula lotou. Escolha outro horário.' }

  // ── Conta ────────────────────────────────────────────────────────────────
  let studentId: string
  if (user) {
    studentId = user.id
    const patch: Record<string, string> = {}
    if (!profile?.phone?.trim() && input.phone?.trim()) patch.phone = input.phone.trim()
    if (Object.keys(patch).length > 0) await admin.from('profiles').update(patch).eq('id', studentId)
  } else {
    const acc = newAccount!
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: acc.email,
      password: acc.password,
      // Sem confirmação: a pessoa precisa entrar no app agora para ver a aula que
      // marcou. É o mesmo que o cadastro de torneio pelo organizador faz.
      email_confirm: true,
      user_metadata: { full_name: acc.name, phone: acc.phone, gender: acc.gender },
    })
    if (userErr || !created?.user) {
      if (userErr?.message?.toLowerCase().includes('already')) {
        return {
          error: 'Este e-mail já tem conta no ArenaHub. Entre com sua senha para marcar a experimental.',
          loginRequired: true,
        }
      }
      return { error: 'Não foi possível criar sua conta. Tente novamente.' }
    }
    studentId = created.user.id
  }

  // Vínculo de aluno, sem plano. Atleta (veio por torneio) passa a aluno: agora
  // ele faz aula. Quem já é aluno ou admin fica como está.
  await admin
    .from('memberships')
    .upsert(
      { user_id: studentId, organization_id: organizationId, role: 'student' },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )
  await admin
    .from('memberships')
    .update({ role: 'student' })
    .eq('user_id', studentId)
    .eq('organization_id', organizationId)
    .eq('role', 'athlete')

  // ── A experimental ───────────────────────────────────────────────────────
  // A linha vem ANTES da reserva: o índice único do CPF é o que segura duas
  // abas enviando ao mesmo tempo, e só a primeira pode chegar à reserva.
  const { data: trial, error: trialErr } = await admin
    .from('trial_bookings')
    .insert({
      organization_id: organizationId,
      name: newAccount?.name ?? profile?.full_name ?? '',
      email,
      phone: newAccount?.phone ?? profile?.phone ?? input.phone?.trim() ?? '',
      session_id: sessionId,
      status: 'pending',
      must_pay_next: false,
      cpf,
      student_id: studentId,
    })
    .select('id')
    .single()
  if (trialErr || !trial) {
    return { error: trialErr?.code === '23505' ? TRIAL_CPF_USED_MESSAGE : 'Erro ao marcar a aula. Tente novamente.' }
  }

  const { error: bookErr } = await admin.rpc('book_session_atomic', {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_max_students: capacity,
    p_type: 'extra',
    p_from_enrollment: false,
    p_credit_used: false,
  })
  if (bookErr) {
    await admin.from('trial_bookings').delete().eq('id', trial.id)
    const lotou = bookErr.message.includes('SESSION_FULL')
    const base = lotou ? 'Esta aula acabou de lotar. Escolha outro horário.' : 'Erro ao marcar a aula. Tente novamente.'
    return { error: user ? base : `${base} Sua conta já foi criada: na próxima vez, é só marcar.` }
  }

  // Aula grátis declarada: o mesmo registro que a experimental do admin grava. O
  // índice único (aluno, sessão) de payments é o que impede a presença de virar
  // aula avulsa em aberto (ver ensureClassDebt).
  const { error: payErr } = await admin.from('payments').insert({
    organization_id: organizationId,
    student_id: studentId,
    session_id: sessionId,
    amount: 0,
    currency: 'BRL',
    status: 'paid',
    type: 'trial',
    gateway: 'manual',
    paid_at: new Date().toISOString(),
    credits_qty: null,
  })
  if (payErr && payErr.code !== '23505') {
    console.error('[createTrialBooking] pré-declaração da experimental falhou', { sessionId, studentId, error: payErr.message })
  }

  // Já entra logado, para cair no app com a aula na agenda.
  if (newAccount) {
    const { error: signErr } = await createClient().auth.signInWithPassword({
      email: newAccount.email,
      password: newAccount.password,
    })
    if (signErr) console.error('[createTrialBooking] login automático falhou', signErr.message)
  }

  revalidatePath('/admin/dashboard')
  revalidatePath(`/admin/grade/${sessionId}`)
  return { success: true, createdAccount: !user }
}
