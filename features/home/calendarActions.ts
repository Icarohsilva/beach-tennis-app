'use server'
// features/home/calendarActions.ts
// Troca de mês no calendário da home.
//
// Uma action e não um parâmetro de URL: a home faz mais de dez consultas para
// montar hero, frequência e agenda da semana, e refazer tudo isso só porque o
// aluno tocou na seta do mês seguinte seria um recarregamento inteiro por
// clique. Aqui só a janela do calendário é rebuscada.
import { getActiveMembership, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { getArenaMonth } from './arenaMonthQuery'
import type { ArenaEvent } from '@/lib/home/arenaAgenda'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export async function loadArenaMonth(monthISO: string): Promise<ArenaEvent[]> {
  // O mês vem do cliente: sem validar, um valor torto viraria data inválida no
  // filtro e a query voltaria vazia (ou com o mês errado) sem explicação.
  if (!MONTH_RE.test(monthISO)) return []

  const user = await getAuthUser()
  if (!user) return []
  const orgId = await getActiveOrgId()
  if (!orgId) return []
  const membership = await getActiveMembership()

  return getArenaMonth({
    orgId,
    userId: user.id,
    monthISO,
    includeKids: membership?.is_dependent ?? false,
  })
}
