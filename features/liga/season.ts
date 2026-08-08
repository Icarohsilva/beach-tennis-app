// features/liga/season.ts
// Temporada corrente de uma academia. Mensal: começa no dia 1º e termina no último dia.
import { createAdminClient } from '@/lib/supabase/server'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { LigaSeason } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Primeiro e último dia (YYYY-MM-DD) do mês de `ref`, em horário de Brasília.
 *
 * Usa `brtToday` (não `ref.getFullYear()/getMonth()`) de propósito: a Vercel roda em
 * UTC, então nas últimas 3h de cada mês em BRT (21h–meia-noite) o relógio UTC já
 * virou o mês seguinte. Sem essa conversão, um ponto creditado nesse intervalo seria
 * lançado na temporada errada — mesma classe de bug já documentada em
 * `lib/liga/streak.ts` e na memória "reference-teste-flake-fuso-brt-utc".
 */
export function monthBounds(ref: Date): { startsOn: string; endsOn: string } {
  const [yStr, mStr] = brtToday(ref).split('-')
  const y = Number(yStr)
  const m = Number(mStr) // 1-12
  // Date.UTC(y, m, 0) = dia 0 do mês seguinte (índice m, já que m é 1-12) = último
  // dia do mês m. Aritmética em UTC, sem depender do fuso do processo Node.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    startsOn: `${y}-${pad(m)}-01`,
    endsOn: `${y}-${pad(m)}-${pad(last)}`,
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

  const { data: created, error: insertErr } = await admin
    .from('liga_seasons')
    .insert({ organization_id: orgId, starts_on: startsOn, ends_on: endsOn, status: 'active' })
    .select('*')
    .maybeSingle()

  if (created) return created as LigaSeason

  // 23505 = unique_violation: outra chamada ganhou a corrida, esperado e silencioso.
  // Qualquer outro erro (FK, permissão, rede) não pode desaparecer em silêncio — sem
  // temporada, toda a Liga daquela academia para de creditar ponto sem aviso nenhum.
  if (insertErr && insertErr.code !== '23505') {
    console.error('[liga] getOrCreateActiveSeason: insert falhou', {
      orgId, startsOn, error: insertErr.message,
    })
  }

  // Corrida perdida (ou o erro logado acima): outra linha pode ter sido criada entre
  // o select e o insert. Lê de novo antes de desistir.
  const { data: raced } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()

  return (raced as LigaSeason | null) ?? null
}
