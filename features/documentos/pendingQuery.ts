// features/documentos/pendingQuery.ts
// Os documentos que ainda bloqueiam o aluno logado — a leitura por trás do
// gate em app/(dashboard)/layout.tsx. Regra de "o que é pendente" é pura e
// mora em lib/documentos/pendingRules.ts; aqui só busca no banco e monta o
// corpo (body) da versão corrente para o DocumentGate renderizar.
//
// Teto natural: uma academia publica poucos documentos por vez (não cresce
// com o tamanho da base de alunos), então `.select()` direto — sem
// fetchAllPages — está correto aqui.
import { createAdminClient } from '@/lib/supabase/server'
import { selectPendingDocuments, type OrgDocumentSummary } from '@/lib/documentos/pendingRules'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PendingDocument {
  id: string
  title: string
  kind: 'ack' | 'sign'
  version: number
  body: string
}

export async function getPendingDocuments(
  client: AdminClient,
  input: { orgId: string; userId: string },
): Promise<PendingDocument[]> {
  const { orgId, userId } = input

  const { data: docsRaw } = await client
    .from('org_documents')
    .select('id, title, kind, status, current_version')
    .eq('organization_id', orgId)
    .eq('status', 'published')

  const documents: OrgDocumentSummary[] = (
    (docsRaw ?? []) as {
      id: string
      title: string
      kind: 'ack' | 'sign'
      status: 'draft' | 'published' | 'archived'
      current_version: number
    }[]
  ).map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    status: d.status,
    currentVersion: d.current_version,
  }))

  if (documents.length === 0) return []

  const { data: acksRaw } = await client
    .from('org_document_acks')
    .select('document_id, version')
    .eq('user_id', userId)
    .in('document_id', documents.map((d) => d.id))

  const acks = ((acksRaw ?? []) as { document_id: string; version: number }[]).map((a) => ({
    documentId: a.document_id,
    version: a.version,
  }))

  const pending = selectPendingDocuments(documents, acks)
  if (pending.length === 0) return []

  const { data: versionsRaw } = await client
    .from('org_document_versions')
    .select('document_id, version, body')
    .in('document_id', pending.map((d) => d.id))

  const bodyByKey = new Map(
    ((versionsRaw ?? []) as { document_id: string; version: number; body: string }[]).map((v) => [
      `${v.document_id}:${v.version}`,
      v.body,
    ]),
  )

  return pending.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    version: d.currentVersion,
    body: bodyByKey.get(`${d.id}:${d.currentVersion}`) ?? '',
  }))
}
