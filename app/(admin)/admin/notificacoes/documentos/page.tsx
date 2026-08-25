// app/(admin)/admin/notificacoes/documentos/page.tsx
import { createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { listOrgDocuments } from '@/features/documentos/adminQuery'
import { DocumentosClient } from './DocumentosClient'

export default async function DocumentosPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const orgId = await getActiveOrgId()
  const documents = orgId ? await listOrgDocuments(createAdminClient(), orgId) : []

  return <DocumentosClient initialDocuments={documents} />
}
