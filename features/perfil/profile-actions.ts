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
