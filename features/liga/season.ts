// features/liga/season.ts
// Temporada corrente de uma academia. Mensal: começa no dia 1º e termina no último dia.
import { createAdminClient } from '@/lib/supabase/server'
import type { LigaSeason } from '@/types'

/** Primeiro e último dia (YYYY-MM-DD) do mês de `ref`, no fuso local do servidor. */
export function monthBounds(ref: Date): { startsOn: string; endsOn: string } {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(y, m + 1, 0).getDate()
  return {
    startsOn: `${y}-${pad(m + 1)}-01`,
    endsOn: `${y}-${pad(m + 1)}-${pad(last)}`,
  }
}

/**
 * Temporada ativa da academia, criando a do mês corrente se ainda não existir.
 *
 * Criar sob demanda em vez de depender só do cron: se o cron falhar ou a academia
 * ligar a Liga no meio do mês, o primeiro ponto creditado já cria a temporada. O
 * unique (organization_id, starts_on) garante que duas chamadas concorrentes não
 * criem duas temporadas.
 */
export async function getOrCreateActiveSeason(
  orgId: string,
  now: Date = new Date(),
): Promise<LigaSeason | null> {
  const admin = createAdminClient()
  const { startsOn, endsOn } = monthBounds(now)

  const { data: existing } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()

  if (existing) return existing as LigaSeason

  const { data: created } = await admin
    .from('liga_seasons')
    .insert({ organization_id: orgId, starts_on: startsOn, ends_on: endsOn, status: 'active' })
    .select('*')
    .maybeSingle()

  if (created) return created as LigaSeason

  // Corrida perdida: outra chamada criou entre o select e o insert. Lê de novo.
  const { data: raced } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()

  return (raced as LigaSeason | null) ?? null
}
