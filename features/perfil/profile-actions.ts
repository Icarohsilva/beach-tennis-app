'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface MedicalProfileData {
  birth_date?: string
  blood_type?: string
  emergency_name?: string
  emergency_phone?: string
  health_notes?: string
}

export async function saveMedicalProfile(data: MedicalProfileData): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase
    .from('medical_profiles')
    .upsert(
      { profile_id: user.id, ...data, updated_at: new Date().toISOString() },
      { onConflict: 'profile_id' },
    )

  if (error) return { error: error.message }
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
    const { error: medicalErr } = await supabase
      .from('medical_profiles')
      .upsert(
        { profile_id: user.id, birth_date: data.birth_date || null, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id' },
      )
    if (medicalErr) return { error: 'Erro ao salvar a data de nascimento.' }
  }

  revalidatePath('/perfil')
  return {}
}
