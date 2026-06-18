'use server'
// features/organizations/actions.ts
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { generateUniqueSlug, generateUniqueInviteCode } from '@/lib/org/identifiers'
import { normalizeSports } from '@/lib/arenas/sports'
import { onlyDigits, isValidDocument } from '@/lib/validation/documento'

// Contato do suporte exibido quando um documento (CPF/CNPJ) já está em uso.
const SUPPORT_CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@arenahub.pro'
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

  // 3. Promove o perfil a admin e marca como dono da org.
  await admin.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  await admin.from('organizations').update({ owner_id: created.user.id }).eq('id', org.id)

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

  // Promove a admin. owner_id continua o dono → o novo entra como professor.
  await admin.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  revalidatePath('/admin/equipe')
  return {}
}

// Remove um professor da academia do dono. Owner-only. Não permite remover o dono.
export async function removeProfessor(profileId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Apenas o dono pode remover professores.' }
  if (profileId === ctx.userId) return { error: 'O dono não pode se remover.' }

  const admin = createAdminClient()
  // Garante que o alvo pertence à mesma academia (evita remover de outra org).
  const { data: target } = await admin
    .from('profiles')
    .select('id, organization_id')
    .eq('id', profileId)
    .single()
  if (!target || target.organization_id !== ctx.organizationId) {
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
