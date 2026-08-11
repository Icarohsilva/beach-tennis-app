'use server'
// features/painel/calendarActions.ts
// Troca de mês no calendário do painel.
//
// Action e não parâmetro de URL, pelo mesmo motivo do calendário do aluno: o
// dashboard monta hero, indicadores, agenda do dia e experimentais pendentes, e
// refazer tudo isso por clique de seta seria um recarregamento inteiro.
import { createAdminClient, getCurrentOrgId, getStaffContext } from '@/lib/supabase/server'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getAdminMonth, type AdminMonth } from './adminMonthQuery'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const EMPTY: AdminMonth = { events: [], generation: {} }

export async function loadAdminMonth(monthISO: string): Promise<AdminMonth> {
  // O mês vem do cliente: sem validar, um valor torto viraria data inválida no
  // filtro e o mês voltaria vazio sem explicação.
  if (!MONTH_RE.test(monthISO)) return EMPTY

  // O calendário mostra a academia inteira — reserva de aluno, rascunho de
  // torneio, ocupação. Só staff da org vê.
  const staff = await getStaffContext()
  if (!staff) return EMPTY
  const orgId = await getCurrentOrgId()
  if (!orgId) return EMPTY

  // Sanidade: getStaffContext já garante membership na org ativa, mas a role
  // pode ser de aluno se a sessão vier de outro contexto.
  const { data: membership } = await createAdminClient()
    .from('memberships')
    .select('role')
    .eq('user_id', staff.userId)
    .eq('organization_id', orgId)
    .maybeSingle()
  const role = (membership as { role: string } | null)?.role
  if (role !== 'admin' && role !== 'super_admin') return EMPTY

  return getAdminMonth({ orgId, monthISO, todayISO: brtToday(new Date()) })
}
