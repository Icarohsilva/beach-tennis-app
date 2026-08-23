// lib/org/activeOrg.ts
// Decide a academia ativa a partir das memberships do usuário e do cookie.
// Função pura: sem rede, sem cookies — testável isoladamente.

// Nome do cookie da academia ativa. Declarado aqui (e não no server action) para
// evitar ciclo de import entre setActiveOrg.ts e lib/supabase/server.ts.
export const ACTIVE_ORG_COOKIE = 'active_org_id'

export interface MembershipLite {
  organization_id: string
}

export type ActiveOrgResolution =
  | { status: 'none' } // usuário sem nenhuma membership
  | { status: 'active'; orgId: string } // resolvido (cookie válido ou membership única)
  | { status: 'choose' } // 2+ memberships e cookie ausente/inválido → precisa escolher

export function resolveActiveOrg(
  memberships: MembershipLite[],
  cookieOrgId: string | null,
): ActiveOrgResolution {
  if (memberships.length === 0) return { status: 'none' }
  const ids = memberships.map((mm) => mm.organization_id)
  if (cookieOrgId && ids.includes(cookieOrgId)) return { status: 'active', orgId: cookieOrgId }
  if (memberships.length === 1) return { status: 'active', orgId: ids[0] }
  return { status: 'choose' }
}

/**
 * A pessoa é aluno (ou staff) de alguma academia?
 *
 * Separa quem tem rotina — turma, plano, ranking — de quem só passou por uma
 * academia para jogar um torneio (`athlete`) ou ainda não passou por nenhuma.
 * Para o visitante, Home, Liga e a agenda de aulas seriam telas vazias, então é
 * este booleano que decide o menu que ele vê.
 *
 * Papel desconhecido conta como aluno de propósito: se um papel novo aparecer
 * no enum e ninguém atualizar esta lista, a falha é mostrar menu demais — nunca
 * esconder o app de quem paga por ele.
 */
export function hasStudentAccess(memberships: { role: string }[]): boolean {
  return memberships.some((m) => m.role !== 'athlete')
}

/**
 * A pessoa é staff (admin/professor) da academia ATIVA?
 *
 * Existe porque o app do aluno e o painel admin são duas casas, e quem tem as
 * duas chaves precisa de porta entre elas: o admin que cai em /home (é o
 * `start_url` do PWA) ficava sem nenhum caminho de volta ao painel a não ser
 * sair e entrar de novo — o login é ciente do papel, a área do aluno não era.
 *
 * Escopado à academia ativa de propósito: ser admin numa academia não dá painel
 * na outra. `role === 'admin'` é o mesmo teste que app/(admin)/layout.tsx aplica
 * (professor também é 'admin'; o que o separa do dono é `is_co_owner`, e isso é
 * decidido lá dentro por `canAccessArea`) — se os dois discordassem, este link
 * levaria a um redirect de volta.
 */
export function isStaffOfActiveOrg(
  memberships: { organization_id: string; role: string }[],
  activeOrgId: string | null,
): boolean {
  if (!activeOrgId) return false
  return memberships.some((m) => m.organization_id === activeOrgId && m.role === 'admin')
}
