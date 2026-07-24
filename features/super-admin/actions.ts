'use server'
// features/super-admin/actions.ts
// Painel de PLATAFORMA. Todas as actions re-checam is_platform_admin (defesa em
// profundidade — não confiam só no gate do layout) e usam service role. Leitura
// CROSS-ORG é intencional aqui (é o ponto do painel); seguro porque gateado.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { OrgListRow } from '@/lib/superAdmin/filterOrgs'

// Lê o usuário logado + is_platform_admin. Retorna { userId } ou { error }.
export async function requirePlatformAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) return { error: 'Acesso negado.' }
  return { userId: user.id }
}

// Lista todas as academias com dono (nome) + status da assinatura. Batch para
// evitar N+1 (nomes de donos e assinaturas resolvidos em 2 queries agregadas).
export async function listOrganizations(): Promise<{ rows?: OrgListRow[]; error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()

  const { data: orgsRaw } = await admin
    .from('organizations')
    .select('id, name, city, state, owner_id, status, created_at')
    .order('created_at', { ascending: false })
  const orgs = (orgsRaw ?? []) as Array<{
    id: string
    name: string
    city: string | null
    state: string | null
    owner_id: string | null
    status: 'active' | 'suspended'
    created_at: string
  }>

  const ownerIds = Array.from(
    new Set(orgs.map((o) => o.owner_id).filter(Boolean)),
  ) as string[]
  const { data: owners } = ownerIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', ownerIds)
    : { data: [] }
  const ownerName = new Map(
    ((owners ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]),
  )

  const orgIds = orgs.map((o) => o.id)
  const { data: subs } = orgIds.length
    ? await admin
        .from('platform_subscriptions')
        .select('organization_id, status')
        .in('organization_id', orgIds)
    : { data: [] }
  const subStatus = new Map(
    ((subs ?? []) as Array<{ organization_id: string; status: string }>).map((s) => [
      s.organization_id,
      s.status,
    ]),
  )

  const rows: OrgListRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    city: o.city,
    state: o.state,
    owner_name: o.owner_id ? ownerName.get(o.owner_id) ?? null : null,
    org_status: o.status,
    sub_status: subStatus.get(o.id) ?? 'none',
    created_at: o.created_at,
  }))
  return { rows }
}

export interface OrgDetail {
  id: string
  name: string
  slug: string
  city: string | null
  state: string | null
  description: string | null
  status: 'active' | 'suspended'
  created_at: string
  owner_name: string | null
  owner_email: string | null
  sub_status: string
  trial_ends_at: string | null
  current_period_end: string | null
  students: number
  admins: number
  tournaments: number
}

// Detalhe de uma academia: dados + dono (nome + e-mail via auth.users) +
// assinatura + 3 contadores (count exact/head, escopados por organization_id).
export async function getOrganizationDetail(
  orgId: string,
): Promise<{ detail?: OrgDetail; error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()

  const { data: org } = await admin
    .from('organizations')
    .select('id, name, slug, city, state, description, status, created_at, owner_id')
    .eq('id', orgId)
    .single()
  if (!org) return { error: 'Academia não encontrada.' }

  let owner_name: string | null = null
  let owner_email: string | null = null
  if (org.owner_id) {
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', org.owner_id)
      .single()
    owner_name = prof?.full_name ?? null
    const { data: authUser } = await admin.auth.admin.getUserById(org.owner_id)
    owner_email = authUser?.user?.email ?? null
  }

  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('status, trial_ends_at, current_period_end')
    .eq('organization_id', orgId)
    .maybeSingle()

  const [studentsRes, adminsRes, tournamentsRes] = await Promise.all([
    admin
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'student'),
    admin
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'admin'),
    admin
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId),
  ])

  return {
    detail: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      city: org.city,
      state: org.state,
      description: org.description,
      status: org.status,
      created_at: org.created_at,
      owner_name,
      owner_email,
      sub_status: sub?.status ?? 'none',
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      students: studentsRes.count ?? 0,
      admins: adminsRes.count ?? 0,
      tournaments: tournamentsRes.count ?? 0,
    },
  }
}

export async function suspendOrganization(orgId: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'suspended' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível suspender a academia.' }
  revalidatePath('/super-admin')
  revalidatePath(`/super-admin/${orgId}`)
  return {}
}

export async function reactivateOrganization(orgId: string): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status: 'active' }).eq('id', orgId)
  if (error) return { error: 'Não foi possível reativar a academia.' }
  revalidatePath('/super-admin')
  revalidatePath(`/super-admin/${orgId}`)
  return {}
}

// ---------------------------------------------------------------------------
// Solicitações de exclusão de conta e de reembolso — fluxos de REGISTRO (ver
// migration 20260724100000_legal_foundation.sql). A execução (anonimizar dados,
// devolver dinheiro) continua manual/deliberada; aqui só se marca o status.
// ---------------------------------------------------------------------------

export type AccountDeletionStatus = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
export type PlatformRefundStatus = 'pendente' | 'aprovada' | 'recusada' | 'reembolsada'

export async function setAccountDeletionStatus(
  id: string,
  status: AccountDeletionStatus,
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const isTerminal = status === 'concluida' || status === 'cancelada'
  const { error } = await admin
    .from('account_deletion_requests')
    .update({ status, resolved_at: isTerminal ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) return { error: 'Não foi possível atualizar a solicitação.' }
  revalidatePath('/super-admin/exclusoes')
  return {}
}

export async function setPlatformRefundStatus(
  id: string,
  status: PlatformRefundStatus,
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return { error: gate.error }
  const admin = createAdminClient()
  const isTerminal = status === 'recusada' || status === 'reembolsada'
  const { error } = await admin
    .from('platform_refund_requests')
    .update({ status, resolved_at: isTerminal ? new Date().toISOString() : null, resolved_by: gate.userId })
    .eq('id', id)
  if (error) return { error: 'Não foi possível atualizar a solicitação.' }
  revalidatePath('/super-admin/reembolsos')
  return {}
}
