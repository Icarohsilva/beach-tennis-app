import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Organization } from '@/types'

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

// Academia (tenant) do usuário autenticado. Use para escopar TODA query feita com
// createAdminClient (service role ignora a RLS) por organization_id e evitar vazamento
// de dados entre academias.
export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return data?.organization_id ?? null
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
