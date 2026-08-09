'use server'
// features/liga/prizeActions.ts
// Cadastro dos prêmios da temporada e baixa da entrega. Admin da academia ativa.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { getOrCreateActiveSeason } from './season'

const MAX_DESCRIPTION = 120
const MAX_CREDIT_CLASSES = 20

export interface SavePrizeInput {
  kind: 'leader' | 'promoted'
  /** 1, 2, 3... para 'leader'. Ignorado em 'promoted'. */
  position?: number
  description: string
  creditClasses: number
}

/**
 * Cria ou atualiza o prêmio de uma colocação na temporada corrente.
 *
 * Só mexe na temporada ABERTA: prêmio de temporada fechada já virou `liga_prize_awards`
 * e mudar aqui não reescreveria nada — mas passaria a impressão de que reescreve.
 */
export async function saveLigaPrize(input: SavePrizeInput): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const description = input.description.trim().slice(0, MAX_DESCRIPTION)
  if (!description) return { error: 'Descreva o prêmio.' }

  if (!Number.isInteger(input.creditClasses) || input.creditClasses < 0) {
    return { error: 'Aulas de bônus devem ser um número inteiro não-negativo.' }
  }
  if (input.creditClasses > MAX_CREDIT_CLASSES) {
    return { error: `Máximo de ${MAX_CREDIT_CLASSES} aulas por prêmio.` }
  }

  const position = input.kind === 'leader' ? input.position : null
  if (input.kind === 'leader' && (!position || position < 1 || position > 10)) {
    return { error: 'Colocação inválida.' }
  }

  const admin = createAdminClient()
  const season = await getOrCreateActiveSeason(orgId)
  if (!season) return { error: 'Não foi possível abrir a temporada.' }

  const { error } = await admin.from('liga_prizes').upsert(
    {
      organization_id: orgId,
      season_id: season.id,
      kind: input.kind,
      position,
      description,
      credit_classes: input.creditClasses,
    },
    { onConflict: 'season_id,kind,position' },
  )
  if (error) return { error: 'Erro ao salvar o prêmio.' }

  revalidatePath('/admin/liga')
  revalidatePath('/liga')
  return {}
}

export async function deleteLigaPrize(prizeId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const { error } = await createAdminClient()
    .from('liga_prizes')
    .delete()
    .eq('id', prizeId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao remover o prêmio.' }

  revalidatePath('/admin/liga')
  revalidatePath('/liga')
  return {}
}

/**
 * Marca o prêmio como entregue.
 *
 * Existe porque prêmio físico o sistema não tem como saber: quem sabe é quem
 * entregou. Sem esta baixa, a academia perde o controle de quem já recebeu.
 */
export async function markPrizeDelivered(
  awardId: string,
  delivered: boolean,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const { error } = await createAdminClient()
    .from('liga_prize_awards')
    .update({
      delivered,
      delivered_at: delivered ? new Date().toISOString() : null,
    })
    .eq('id', awardId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao registrar a entrega.' }

  revalidatePath('/admin/liga')
  return {}
}
