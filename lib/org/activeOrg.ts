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
