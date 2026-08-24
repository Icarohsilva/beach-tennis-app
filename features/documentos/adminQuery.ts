// features/documentos/adminQuery.ts
// Leitura do admin para a tela /admin/notificacoes/documentos: a lista com o
// placar de leitura/assinatura, e o detalhe por aluno.
//
// Teto natural (poucos documentos por academia, alunos de UMA academia), então
// `.select()` direto — sem fetchAllPages — está correto aqui, no mesmo
// espírito de pendingQuery.ts.
import { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

export interface OrgDocumentRow {
  id: string
  title: string
  kind: 'ack' | 'sign'
  status: 'draft' | 'published' | 'archived'
  currentVersion: number
  /** Texto da versão corrente — a lista já carrega para abrir o editor sem outra ida ao banco. */
  body: string
  updatedAt: string
  publishedAt: string | null
  ackedCount: number
  totalStudents: number
}

/** Alunos ativos da academia — o mesmo denominador de sendNotification (features/comunidade/actions.ts). */
async function countActiveStudents(client: AdminClient, orgId: string): Promise<number> {
  const { count } = await client
    .from('memberships')
    .select('user_id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .eq('contract_active', true)
    .is('archived_at', null)
  return count ?? 0
}

export async function listOrgDocuments(client: AdminClient, orgId: string): Promise<OrgDocumentRow[]> {
  const { data: docsRaw } = await client
    .from('org_documents')
    .select('id, title, kind, status, current_version, updated_at, published_at')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false })

  const documents = (docsRaw ?? []) as {
    id: string
    title: string
    kind: 'ack' | 'sign'
    status: 'draft' | 'published' | 'archived'
    current_version: number
    updated_at: string
    published_at: string | null
  }[]

  if (documents.length === 0) return []

  const totalStudents = await countActiveStudents(client, orgId)

  const { data: acksRaw } = await client
    .from('org_document_acks')
    .select('document_id, version')
    .in('document_id', documents.map((d) => d.id))

  const acks = (acksRaw ?? []) as { document_id: string; version: number }[]
  const ackedCountByDoc = new Map<string, number>()
  for (const doc of documents) {
    const n = acks.filter((a) => a.document_id === doc.id && a.version === doc.current_version).length
    ackedCountByDoc.set(doc.id, n)
  }

  const { data: versionsRaw } = await client
    .from('org_document_versions')
    .select('document_id, version, body')
    .in('document_id', documents.map((d) => d.id))
  const bodyByKey = new Map(
    ((versionsRaw ?? []) as { document_id: string; version: number; body: string }[]).map((v) => [
      `${v.document_id}:${v.version}`,
      v.body,
    ]),
  )

  return documents.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    status: d.status,
    currentVersion: d.current_version,
    body: bodyByKey.get(`${d.id}:${d.current_version}`) ?? '',
    updatedAt: d.updated_at,
    publishedAt: d.published_at,
    ackedCount: ackedCountByDoc.get(d.id) ?? 0,
    totalStudents,
  }))
}

export interface StudentAckStatus {
  userId: string
  name: string
  acked: boolean
  ackedAt: string | null
  signedName: string | null
  signedCpf: string | null
}

export interface OrgDocumentDetail {
  id: string
  title: string
  kind: 'ack' | 'sign'
  status: 'draft' | 'published' | 'archived'
  currentVersion: number
  body: string
  students: StudentAckStatus[]
}

export async function getOrgDocumentDetail(
  client: AdminClient,
  input: { orgId: string; documentId: string },
): Promise<OrgDocumentDetail | null> {
  const { orgId, documentId } = input

  const { data: doc } = await client
    .from('org_documents')
    .select('id, title, kind, status, current_version')
    .eq('id', documentId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!doc) return null

  const { data: version } = await client
    .from('org_document_versions')
    .select('body')
    .eq('document_id', documentId)
    .eq('version', doc.current_version)
    .maybeSingle()

  const { data: membersRaw } = await client
    .from('memberships')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .eq('contract_active', true)
    .is('archived_at', null)

  const memberIds = ((membersRaw ?? []) as { user_id: string }[]).map((m) => m.user_id)

  const { data: profilesRaw } = memberIds.length
    ? await client.from('profiles').select('id, full_name').in('id', memberIds)
    : { data: [] }
  const nameById = new Map(
    ((profilesRaw ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? '']),
  )

  const { data: acksRaw } = memberIds.length
    ? await client
        .from('org_document_acks')
        .select('user_id, acked_at, signed_name, signed_cpf')
        .eq('document_id', documentId)
        .eq('version', doc.current_version)
        .in('user_id', memberIds)
    : { data: [] }

  const ackByUser = new Map(
    (
      (acksRaw ?? []) as {
        user_id: string
        acked_at: string
        signed_name: string | null
        signed_cpf: string | null
      }[]
    ).map((a) => [a.user_id, a]),
  )

  const students: StudentAckStatus[] = memberIds
    .map((userId) => {
      const ack = ackByUser.get(userId)
      return {
        userId,
        name: nameById.get(userId) ?? '',
        acked: !!ack,
        ackedAt: ack?.acked_at ?? null,
        signedName: ack?.signed_name ?? null,
        signedCpf: ack?.signed_cpf ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    status: doc.status,
    currentVersion: doc.current_version,
    body: version?.body ?? '',
    students,
  }
}
