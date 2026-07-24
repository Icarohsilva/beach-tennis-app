'use server'
// features/organizations/actions.ts
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { generateUniqueSlug, generateUniqueInviteCode } from '@/lib/org/identifiers'
import { normalizeSports } from '@/lib/arenas/sports'
import { onlyDigits, isValidDocument } from '@/lib/validation/documento'
import { generateTempPassword } from '@/lib/auth/tempPassword'
import { setStudentType } from '@/features/checkin/actions'
import { acceptLegalDocuments } from '@/features/legal/actions'
import { OWNER_REQUIRED_SLUGS } from '@/lib/legal/documents'

// Contato do suporte exibido quando um documento (CPF/CNPJ) já está em uso.
const SUPPORT_CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.website'
const DOCUMENT_IN_USE_MSG =
  `Já existe uma academia cadastrada com este CPF/CNPJ. Fale com o suporte: ${SUPPORT_CONTACT}`

export interface CreateAcademyInput {
  academyName: string
  fullName: string
  email: string
  password: string
  document: string
  phone?: string
  description?: string
  brandColor?: string
}

export interface CreateAcademyResult {
  error?: string
  inviteCode?: string
}

// Cria a academia e o usuário dono (admin master), de forma quase-atômica.
// Abordagem A: tudo em TS via service role. Rollback da org se o usuário falhar.
export async function createAcademy(input: CreateAcademyInput): Promise<CreateAcademyResult> {
  const admin = createAdminClient()
  const name = input.academyName.trim()
  if (!name) return { error: 'Informe o nome da academia.' }
  if (!input.email.trim() || !input.password) return { error: 'Email e senha são obrigatórios.' }

  // Documento (CPF/CNPJ): valida dígito verificador e exige unicidade global.
  // Guarda só dígitos. 1 documento = 1 academia (anti-fraude de cadastros grátis).
  const document = onlyDigits(input.document ?? '')
  if (!isValidDocument(document)) return { error: 'CPF ou CNPJ inválido.' }

  const { data: docOwner } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_document', document)
    .maybeSingle()
  if (docOwner) return { error: DOCUMENT_IN_USE_MSG }

  const slug = await generateUniqueSlug(admin, name)
  const inviteCode = await generateUniqueInviteCode(admin)

  // 1. Cria a organização (sem owner ainda).
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({
      name,
      slug,
      invite_code: inviteCode,
      owner_document: document,
      status: 'active',
      is_default: false,
      description: input.description?.trim() || null,
      brand_color: input.brandColor?.trim() || null,
    })
    .select('id')
    .single()
  if (orgErr || !org) {
    // 23505 = violação de índice único. Corrida no documento → mesma mensagem.
    if (orgErr?.code === '23505' && orgErr.message?.includes('owner_document')) {
      return { error: DOCUMENT_IN_USE_MSG }
    }
    return { error: 'Não foi possível criar a academia. Tente outro nome.' }
  }

  // Assinatura da plataforma em trial (1º mês grátis). on delete cascade garante limpeza
  // junto com a org no rollback. Falha aqui não deve abortar o cadastro (best-effort);
  // o backfill/edição posterior cobre, e a org sem linha cai no paywall (seguro).
  await admin.from('platform_subscriptions').insert({
    organization_id: org.id,
    status: 'trialing',
    trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  })

  // 2. Cria o usuário no Auth. O trigger handle_new_user lê org_invite_code e
  // liga o perfil a esta org. email_confirm:true permite login imediato.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || undefined,
      org_invite_code: inviteCode,
    },
  })

  if (userErr || !created?.user) {
    // Rollback: apaga a org órfã.
    await admin.from('organizations').delete().eq('id', org.id)
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse email.'
      : 'Não foi possível criar o usuário. Tente novamente.'
    return { error: msg }
  }

  // 3. Marca o usuário como dono da org e promove a membership a admin
  //    (a membership é a fonte da verdade do papel por-academia).
  await admin.from('organizations').update({ owner_id: created.user.id }).eq('id', org.id)
  await admin
    .from('memberships')
    .update({ role: 'admin' })
    .eq('user_id', created.user.id)
    .eq('organization_id', org.id)

  // Registra o aceite dos termos + contrato SaaS + DPA. Já rodamos 100% server-side
  // com created.user.id confiável — sem o risco de IDOR do fluxo de cadastro de aluno
  // (ver features/legal/actions.ts). Best-effort: não reverte a criação da academia.
  const acceptRes = await acceptLegalDocuments(created.user.id, OWNER_REQUIRED_SLUGS)
  if (acceptRes.error) {
    console.error('[createAcademy] falha ao registrar aceite legal', acceptRes.error)
  }

  return { inviteCode }
}

// Resolve um código de convite para o nome da academia (uso público no cadastro).
// Retorna só dados não-sensíveis (nome). null se inválido/inativo.
export async function resolveInviteCode(
  code: string,
): Promise<{ orgId: string; orgName: string } | null> {
  const c = code.trim().toUpperCase()
  if (!c) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('id, name, status')
    .eq('invite_code', c)
    .maybeSingle()
  if (!data || data.status !== 'active') return null
  return { orgId: data.id, orgName: data.name }
}

export interface CreateProfessorInput {
  fullName: string
  email: string
  password: string
  phone?: string
}

// Cria um professor na academia do dono logado. Owner-only.
export async function createProfessor(input: CreateProfessorInput): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode adicionar professores.' }

  const admin = createAdminClient()
  // Busca o invite_code da academia para o trigger ligar o novo perfil à org.
  const { data: org } = await admin
    .from('organizations')
    .select('invite_code')
    .eq('id', ctx.organizationId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || undefined,
      org_invite_code: org.invite_code,
    },
  })
  if (userErr || !created?.user) {
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse email.'
      : 'Não foi possível criar o professor.'
    return { error: msg }
  }

  // Promove a membership desta academia a admin (fonte da verdade do papel).
  // owner_id continua o dono → o novo entra como professor (admin não-dono).
  await admin
    .from('memberships')
    .update({ role: 'admin' })
    .eq('user_id', created.user.id)
    .eq('organization_id', ctx.organizationId)
  revalidatePath('/admin/equipe')
  return {}
}

export interface CreateStudentInput {
  fullName: string
  email: string
  gender?: 'M' | 'F'
  partner?: { type: 'wellhub' | 'totalpass'; partnerId: string; monthlyTarget: number }
}

// Cria um aluno na academia ativa com senha temporária gerada pelo sistema, forçando
// a troca no 1º login (must_change_password). Admin-only (qualquer staff role='admin').
export async function createStudent(
  input: CreateStudentInput,
): Promise<{ error?: string; password?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  // Autorização: a membership da academia ativa precisa ser admin (staff).
  const { data: caller } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .single()
  if (caller?.role !== 'admin') return { error: 'Apenas o staff pode criar alunos.' }

  const email = input.email.trim()
  const fullName = input.fullName.trim()
  if (!fullName) return { error: 'Informe o nome do aluno.' }
  if (!email) return { error: 'Informe o e-mail do aluno.' }

  const { data: org } = await admin
    .from('organizations')
    .select('invite_code')
    .eq('id', ctx.organizationId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  const password = generateTempPassword()

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      org_invite_code: org.invite_code,
      must_change_password: true,
    },
  })
  if (userErr || !created?.user) {
    const msg = userErr?.message?.toLowerCase().includes('already')
      ? 'Já existe uma conta com esse e-mail.'
      : 'Não foi possível criar o aluno.'
    return { error: msg }
  }

  // Opcional: vincular tipo parceiro (grava wellhub_id/totalpass_id + meta na membership).
  if (input.partner) {
    await setStudentType(created.user.id, {
      partner: {
        type: input.partner.type,
        partnerId: input.partner.partnerId,
        monthlyTarget: input.partner.monthlyTarget,
      },
    })
  }

  // Gênero (identidade) — opcional na criação.
  if (input.gender === 'M' || input.gender === 'F') {
    await admin.from('profiles').update({ gender: input.gender }).eq('id', created.user.id)
  }

  revalidatePath('/admin/alunos')
  return { password }
}

// Remove um professor da academia do dono. Owner-only. Não permite remover o dono.
export async function removeProfessor(profileId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode remover professores.' }
  if (profileId === ctx.userId) return { error: 'O dono não pode se remover.' }

  const admin = createAdminClient()
  // Garante que o alvo pertence à mesma academia (evita remover de outra org).
  // O vínculo por-academia vive em memberships, não mais em profiles.
  const { data: target } = await admin
    .from('memberships')
    .select('user_id')
    .eq('user_id', profileId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (!target) {
    return { error: 'Professor não encontrado nesta academia.' }
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(profileId)
  if (delErr) return { error: 'Não foi possível remover o professor.' }
  revalidatePath('/admin/equipe')
  return {}
}

// ---------------------------------------------------------------------------
// completeOnboarding (owner only) — tela obrigatória pós-cadastro.
// Grava endereço + vitrine + personalização e marca onboarding_completed.
// ---------------------------------------------------------------------------

export interface CompleteOnboardingInput {
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
  is_listed: boolean
  description: string
  brand_color: string
}

export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode concluir o cadastro da academia.' }

  if (!input.cep.trim()) return { error: 'Informe o CEP.' }
  if (!input.city.trim()) return { error: 'Informe a cidade.' }
  if (!input.no_number && !input.address_number.trim()) {
    return { error: 'Informe o número ou marque "Sem número".' }
  }

  const admin = createAdminClient()
  const { error: updErr } = await admin
    .from('organizations')
    .update({
      cep: input.cep.trim() || null,
      state: input.state.trim().toUpperCase() || null,
      city: input.city.trim() || null,
      neighborhood: input.neighborhood.trim() || null,
      address_line: input.address_line.trim() || null,
      address_number: input.no_number ? null : input.address_number.trim() || null,
      no_number: input.no_number,
      sports: normalizeSports(input.sports),
      whatsapp: input.whatsapp.trim() || null,
      is_listed: input.is_listed,
      description: input.description.trim() || null,
      brand_color: input.brand_color.trim() || null,
      onboarding_completed: true,
    })
    .eq('id', ctx.organizationId)
  if (updErr) return { error: 'Erro ao salvar. Tente novamente.' }

  revalidatePath('/arenas')
  revalidatePath('/admin/configuracoes')
  return {}
}

// Entrada self-service numa 2ª (ou N-ésima) academia por código de convite, com o
// usuário JÁ logado. Cria a membership student e ativa a academia. Idempotente.
export async function joinAcademy(inviteCode: string): Promise<{ error?: string; orgId?: string }> {
  const code = inviteCode.trim().toUpperCase()
  if (!code) return { error: 'Informe o código de convite.' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('id, status')
    .eq('invite_code', code)
    .maybeSingle()
  if (!org || org.status !== 'active') return { error: 'Código de convite inválido.' }

  // Cria a membership se ainda não existir (não rebaixa quem já é admin).
  const { error: insErr } = await admin
    .from('memberships')
    .insert({ user_id: user.id, organization_id: org.id, role: 'student' })
  // 23505 = já participa: tudo bem, segue para ativar.
  if (insErr && insErr.code !== '23505') {
    return { error: 'Não foi possível entrar na academia.' }
  }

  revalidatePath('/home')
  return { orgId: org.id }
}

// Aluno define o próprio gênero (identidade em profiles).
export async function selfSetGender(
  gender: 'M' | 'F' | null,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  if (gender !== 'M' && gender !== 'F' && gender !== null) {
    return { error: 'Gênero inválido.' }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ gender }).eq('id', user.id)
  if (error) return { error: 'Erro ao salvar gênero. Tente novamente.' }
  revalidatePath('/perfil')
  return {}
}
