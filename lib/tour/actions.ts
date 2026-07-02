'use server'

import { createClient } from '@/lib/supabase/server'
import type { TourVariant } from './autostart'

export async function markTourSeen(variant: TourVariant): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const column = variant === 'aluno' ? 'tour_aluno_seen_at' : 'tour_admin_seen_at'
  await supabase
    .from('profiles')
    .update({ [column]: new Date().toISOString() })
    .eq('id', user.id)
}
