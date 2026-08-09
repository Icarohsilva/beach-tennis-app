'use server'

import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { checkProfileComplete } from '@/features/liga/extraPoints'
import { revalidatePath } from 'next/cache'

export interface MedicalProfileData {
  birth_date?: string
  blood_type?: string
  emergency_name?: string
  emergency_phone?: string
  health_notes?: string
}

// medical_profiles.organization_id PRECISA ir explícito no insert. O trigger que o
// preenchia (trg_set_org, derivado de profiles.organization_id) foi removido no cutover
// de identidade (20260624000000) — profiles virou só identidade e a academia passou a
// vir das memberships. A RLS de insert continua exigindo
// `organization_id in (select auth_org_ids())`, então sem esse campo o insert entra com
// NULL e o Postgres rejeita com "new row violates row-level security policy".
async function activeOrgIdOrError(): Promise<{ orgId?: string; error?: string }> {
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada. Recarregue a página e tente de novo.' }
  return { orgId }
}

export async function saveMedicalProfile(data: MedicalProfileData): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { orgId, error: orgError } = await activeOrgIdOrError()
  if (orgError) return { error: orgError }

  const { error } = await supabase
    .from('medical_profiles')
    .upsert(
      { profile_id: user.id, organization_id: orgId, ...data, updated_at: new Date().toISOString() },
      { onConflict: 'profile_id' },
    )

  if (error) return { error: error.message }

  // Liga: preencher a ficha pode ter completado o cadastro.
  if (orgId) await checkProfileComplete(createAdminClient(), orgId, user.id)

  revalidatePath('/perfil')
  return {}
}

export interface PersonalData {
  full_name: string
  phone?: string
  birth_date?: string
}

// Atualiza a identidade do usuário: nome + WhatsApp (profiles) e data de nascimento
// (medical_profiles). Usa o cliente com RLS — cada um edita apenas o próprio perfil.
export async function updatePersonalData(data: PersonalData): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const name = data.full_name?.trim()
  if (!name) return { error: 'Informe seu nome completo.' }

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ full_name: name, phone: data.phone?.trim() || null })
    .eq('id', user.id)
  if (profileErr) return { error: 'Erro ao salvar dados pessoais. Tente novamente.' }

  // birth_date vive em medical_profiles; só grava se o campo veio no formulário.
  if (data.birth_date !== undefined) {
    const { orgId, error: orgError } = await activeOrgIdOrError()
    if (orgError) return { error: orgError }

    const { error: medicalErr } = await supabase
      .from('medical_profiles')
      .upsert(
        {
          profile_id: user.id,
          organization_id: orgId,
          birth_date: data.birth_date || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' },
      )
    // Mensagem genérica escondia a causa real (RLS por organization_id ausente) e
    // custou uma investigação — repassa o detalhe do Postgres.
    if (medicalErr) return { error: `Erro ao salvar a data de nascimento: ${medicalErr.message}` }
  }

  const { orgId: ligaOrgId } = await activeOrgIdOrError()
  if (ligaOrgId) await checkProfileComplete(createAdminClient(), ligaOrgId, user.id)

  revalidatePath('/perfil')
  return {}
}
