import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Organization, Membership } from '@/types'
import { resolveActiveOrg, ACTIVE_ORG_COOKIE, type ActiveOrgResolution } from '@/lib/org/activeOrg'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {}
        },
      },
    },
  )
}

export function createAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}

// Memberships do usuário logado, com nome/slug da academia (para a tela de seleção
// e o seletor do topo). Lê via RLS (memberships_select_own).
export interface MembershipWithOrg {
  organization_id: string
  role: string
  org_name: string
  org_slug: string
}

export async function getMemberships(): Promise<MembershipWithOrg[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('memberships')
    .select('organization_id, role, organizations(name, slug)')
    .eq('user_id', user.id)
  return ((data ?? []) as Array<{
    organization_id: string
    role: string
    organizations: { name: string; slug: string } | { name: string; slug: string }[] | null
  }>).map((r) => {
    const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return {
      organization_id: r.organization_id,
      role: r.role,
      org_name: o?.name ?? '',
      org_slug: o?.slug ?? '',
    }
  })
}

// Resolução completa (none | active | choose). Usada pelos layouts para decidir
// redirect para /selecionar-academia (Plano 3). Hoje, com 1 membership, sempre active.
export async function resolveActiveOrgForUser(): Promise<ActiveOrgResolution> {
  const memberships = await getMemberships()
  const cookieOrgId = cookies().get(ACTIVE_ORG_COOKIE)?.value ?? null
  return resolveActiveOrg(
    memberships.map((mm) => ({ organization_id: mm.organization_id })),
    cookieOrgId,
  )
}

// Id da academia ativa (null se não resolvida — sem membership ou precisa escolher).
export async function getActiveOrgId(): Promise<string | null> {
  const res = await resolveActiveOrgForUser()
  return res.status === 'active' ? res.orgId : null
}

// Membership do usuário na academia ativa (campos por-academia: level, credits, etc.).
export async function getActiveMembership(): Promise<Membership | null> {
  const orgId = await getActiveOrgId()
  if (!orgId) return null
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await createAdminClient()
    .from('memberships')
    .select('*')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  return (data as Membership) ?? null
}

// Academia (tenant) ativa do usuário. Deriva da membership ativa (cookie), NÃO mais de
// profiles.organization_id. Use para escopar TODA query feita com createAdminClient
// (service role ignora a RLS) por organization_id e evitar vazamento entre academias.
export async function getCurrentOrgId(): Promise<string | null> {
  return getActiveOrgId()
}

export async function getCurrentOrg(): Promise<Organization | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null
  const { data } = await createAdminClient()
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()
  return (data as Organization) ?? null
}

export interface StaffContext {
  userId: string
  organizationId: string
  isOwner: boolean
}

// Contexto de staff do admin logado. isOwner = é o dono (owner_id) da academia.
// Retorna null se não houver usuário ou perfil/org.
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const orgId = await getActiveOrgId()
  if (!orgId) return null

  const admin = createAdminClient()
  // Papel vem da membership da academia ativa (não mais de profiles.role).
  const { data: membership } = await admin
    .from('memberships')
    .select('role, is_co_owner')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (!membership) return null

  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .single()

  return {
    userId: user.id,
    organizationId: orgId,
    // Dono original (owner_id) OU co-dono (is_co_owner na membership) — mesmo poder.
    isOwner: org?.owner_id === user.id || membership.is_co_owner === true,
  }
}

// Guard para páginas owner-only. Redireciona professor para o dashboard.
export async function requireOwner(): Promise<StaffContext> {
  const ctx = await getStaffContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) redirect('/admin/dashboard')
  return ctx
}
