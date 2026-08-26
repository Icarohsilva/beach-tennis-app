'use server'
// features/aulas/studentIdentityActions.ts
// Identidade do aluno vista pelo admin: editar nome/telefone/gênero/e-mail,
// mandar link de redefinição de senha (WhatsApp ou e-mail) e excluir o
// cadastro permanentemente. Separado de adminActions.ts (operação: matrícula,
// chamada, crédito) porque este arquivo é sobre QUEM a pessoa é no sistema.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { canPermanentlyDelete } from '@/lib/aulas/studentIdentity'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { sendEmail } from '@/lib/notifications/email'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import type { Gender } from '@/types'

function revalidateStudentPaths(studentId: string) {
  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
}

// ---------------------------------------------------------------------------
// updateStudentIdentity
// ---------------------------------------------------------------------------

export interface UpdateStudentIdentityInput {
  full_name: string
  phone?: string | null
  gender?: Gender | null
  /** Só para quem tem login (auth.users). Cadastro gerenciado ignora este campo. */
  email?: string | null
}

export async function updateStudentIdentity(
  studentId: string,
  input: UpdateStudentIdentityInput,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const fullName = input.full_name.trim()
  if (!fullName) return { error: 'Informe o nome completo.' }

  const adminClient = createAdminClient()

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .maybeSingle()
  if (!membership) return { error: 'Aluno não encontrado nesta academia.' }

  const { data: profile } = await adminClient
    .from('profiles')
    .select('deleted_at')
    .eq('id', studentId)
    .maybeSingle()
  if (!profile) return { error: 'Aluno não encontrado.' }
  if (profile.deleted_at) return { error: 'Este cadastro foi excluído permanentemente.' }

  const profileUpdate: { full_name: string; phone: string | null; gender?: Gender | null } = {
    full_name: fullName,
    phone: input.phone?.trim() || null,
  }
  if (input.gender !== undefined) profileUpdate.gender = input.gender

  const { error: profileErr } = await adminClient
    .from('profiles')
    .update(profileUpdate)
    .eq('id', studentId)
  if (profileErr) return { error: 'Erro ao salvar os dados. Tente novamente.' }

  // E-mail vive em auth.users, não em profiles. Só existe para quem tem login
  // — getUserById volta vazio para cadastro gerenciado, e a troca é pulada em
  // silêncio (a UI já esconde este campo nesse caso: virar login depois não é
  // possível hoje, createUser não aceita id fixo).
  if (input.email !== undefined) {
    const email = input.email?.trim()
    if (email) {
      const { data: existing } = await adminClient.auth.admin.getUserById(studentId)
      if (existing?.user) {
        const { error: emailErr } = await adminClient.auth.admin.updateUserById(studentId, { email })
        if (emailErr) {
          const msg = emailErr.message.toLowerCase().includes('already')
            ? 'Já existe uma conta com esse e-mail.'
            : 'Erro ao atualizar o e-mail. Tente novamente.'
          return { error: msg }
        }
      }
    }
  }

  revalidateStudentPaths(studentId)
  return {}
}

// ---------------------------------------------------------------------------
// sendPasswordResetLink — admin manda o link de definir/redefinir senha
// ---------------------------------------------------------------------------

/**
 * Gera um link de recuperação de senha (Supabase Auth) e entrega pelo canal
 * escolhido. Serve tanto para "esqueci a senha" quanto para o aluno recém
 * criado definir a própria senha em vez de digitar a temporária — por isso
 * fica disponível na ficha do aluno E na tela de "aluno criado".
 */
export async function sendPasswordResetLink(
  studentId: string,
  channel: 'whatsapp' | 'email',
): Promise<{ error?: string; whatsappUrl?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Sem este filtro, qualquer admin autenticado (de QUALQUER academia)
  // conseguiria gerar e ler o link de recuperação — que loga como o dono da
  // conta — de qualquer pessoa da plataforma, só passando o id. O escopo por
  // organização é o que limita isso a quem já podia ver este cadastro.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('user_id')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'Pessoa não encontrada nesta academia.' }

  const { data: emailRow } = await adminClient
    .from('user_emails')
    .select('email')
    .eq('id', studentId)
    .maybeSingle()
  const email = (emailRow?.email as string | null) ?? null
  if (!email) return { error: 'Este cadastro não tem login (e-mail) — não é possível enviar link de senha.' }

  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${getSiteUrl()}/nova-senha` },
  })
  const actionLink = linkData?.properties?.action_link
  if (linkErr || !actionLink) {
    console.error('[sendPasswordResetLink] generateLink falhou', linkErr)
    return { error: 'Não foi possível gerar o link. Tente novamente.' }
  }

  if (channel === 'whatsapp') {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('phone, full_name')
      .eq('id', studentId)
      .maybeSingle()
    const phone = profile?.phone as string | null | undefined
    if (!phone) return { error: 'Este aluno não tem telefone cadastrado.' }
    const firstName = ((profile?.full_name as string | undefined) ?? '').split(' ')[0]
    const whatsappUrl = buildWhatsAppUrl(
      phone,
      `Olá${firstName ? ` ${firstName}` : ''}! Aqui está o link para você definir sua senha de acesso: ${actionLink}`,
    )
    return { whatsappUrl }
  }

  try {
    await sendEmail({
      to: email,
      subject: 'Defina sua senha de acesso',
      html: `<p>Olá!</p><p>Use o link abaixo para definir sua senha de acesso ao app:</p><p><a href="${actionLink}">${actionLink}</a></p><p>Se você não pediu isso, pode ignorar este e-mail.</p>`,
    })
  } catch (e) {
    console.error('[sendPasswordResetLink] sendEmail falhou', e)
    return { error: 'Não foi possível enviar o e-mail. Tente novamente.' }
  }
  return {}
}

// ---------------------------------------------------------------------------
// permanentlyDeleteStudent
// ---------------------------------------------------------------------------

/**
 * Exclusão PERMANENTE: bloqueia o login e anonimiza a identidade. Não é
 * DELETE físico (ver migração 20260826001000) — attendance, pagamentos,
 * créditos e pontos da Liga continuam intactos, agora sem nome ligado a
 * eles. A pessoa só volta a acessar criando um cadastro novo.
 */
export async function permanentlyDeleteStudent(studentId: string): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { data: membershipRaw } = await adminClient
    .from('memberships')
    .select('role, archived_at')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membershipRaw) return { error: 'Aluno não encontrado nesta academia.' }
  const membership = membershipRaw as { role: string; archived_at: string | null }

  const { data: profileRaw } = await adminClient
    .from('profiles')
    .select('deleted_at')
    .eq('id', studentId)
    .maybeSingle()
  if (!profileRaw) return { error: 'Aluno não encontrado.' }
  const profile = profileRaw as { deleted_at: string | null }

  // Multi-vínculo: profiles é compartilhada entre academias, então excluir
  // anonimiza a identidade em TODAS elas. Sem checar as outras, a academia A
  // apagaria em silêncio o cadastro de alguém ainda ativo (matriculado,
  // pagando) na academia B — o próprio motivo de deleted_at morar em profiles
  // e não em memberships (ver 20260826001000_profiles_deleted_at.sql).
  const { data: otherMembershipsRaw } = await adminClient
    .from('memberships')
    .select('archived_at')
    .eq('user_id', studentId)
    .neq('organization_id', orgId)
  const hasActiveMembershipElsewhere = (
    (otherMembershipsRaw ?? []) as { archived_at: string | null }[]
  ).some((m) => !m.archived_at)

  const verdict = canPermanentlyDelete(
    {
      role: membership.role,
      membershipArchivedAt: membership.archived_at,
      profileDeletedAt: profile.deleted_at,
      hasActiveMembershipElsewhere,
    },
    studentId === userId,
  )
  if (!verdict.ok) return { error: verdict.reason }

  const now = new Date().toISOString()

  // 1. Ficha médica: dado sensível sem razão de continuar existindo depois
  // que a pessoa saiu de vez.
  await adminClient.from('medical_profiles').delete().eq('profile_id', studentId)

  // 2. Login: revoga o acesso. Cadastro gerenciado (sem e-mail) não tem
  // usuário de auth — getUserById volta vazio e o delete é pulado.
  const { data: authUser } = await adminClient.auth.admin.getUserById(studentId)
  if (authUser?.user) {
    const { error: authDelErr } = await adminClient.auth.admin.deleteUser(studentId)
    if (authDelErr) {
      console.error('[permanentlyDeleteStudent] deleteUser falhou', authDelErr)
      return { error: 'Não foi possível revogar o acesso. Tente novamente.' }
    }
  }

  // 3. Identidade anonimizada. profiles é compartilhada entre academias — o
  // histórico (attendance/pagamento/crédito/Liga) segue apontando para o
  // mesmo id, só que sem nome ligado a ele daqui pra frente.
  const { error: profileErr } = await adminClient
    .from('profiles')
    .update({
      full_name: 'Aluno removido',
      phone: null,
      avatar_url: null,
      gender: null,
      city: null,
      deleted_at: now,
    })
    .eq('id', studentId)
  if (profileErr) {
    console.error('[permanentlyDeleteStudent] profiles.update falhou', profileErr)
    return { error: 'Login removido, mas houve um erro ao anonimizar o cadastro. Contate o suporte.' }
  }

  revalidateStudentPaths(studentId)
  return {}
}
