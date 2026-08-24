'use server'
// features/documentos/adminActions.ts
// CRUD do admin para termos/comunicados obrigatórios, dentro de Notificações:
// criar, publicar, editar (com a escolha correção × mudança de conteúdo) e
// arquivar. A regra de "precisa perguntar?" e "o que carregar para a versão
// nova" é pura e mora em lib/documentos/versioningRules.ts — aqui só busca e
// grava.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import {
  requiresEditModeChoice,
  carryForwardAcks,
  type EditMode,
  type ExistingAck,
} from '@/lib/documentos/versioningRules'

type AdminClient = ReturnType<typeof createAdminClient>

async function requireAdminOrg(
  admin: AdminClient,
): Promise<{ orgId: string; userId: string } | { error: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado.' }
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .maybeSingle()
  if (!membership) return { error: 'Sem permissão.' }

  return { orgId, userId: user.id }
}

function validateInput(title: string, body: string): string | null {
  if (!title.trim()) return 'Título é obrigatório.'
  if (!body.trim()) return 'Conteúdo é obrigatório.'
  return null
}

export async function createDocument(input: {
  title: string
  kind: 'ack' | 'sign'
  body: string
}): Promise<{ error?: string; id?: string }> {
  const admin = createAdminClient()
  const ctx = await requireAdminOrg(admin)
  if ('error' in ctx) return ctx

  const invalid = validateInput(input.title, input.body)
  if (invalid) return { error: invalid }

  const { data: doc, error } = await admin
    .from('org_documents')
    .insert({
      organization_id: ctx.orgId,
      title: input.title.trim(),
      kind: input.kind,
      status: 'draft',
      current_version: 1,
      created_by: ctx.userId,
    })
    .select('id')
    .single()
  if (error || !doc) return { error: 'Erro ao criar documento.' }

  const { error: versionError } = await admin.from('org_document_versions').insert({
    document_id: doc.id,
    version: 1,
    body: input.body.trim(),
    created_by: ctx.userId,
  })
  if (versionError) return { error: 'Erro ao salvar o conteúdo.' }

  revalidatePath('/admin/notificacoes/documentos')
  return { id: doc.id as string }
}

export async function publishDocument(documentId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const ctx = await requireAdminOrg(admin)
  if ('error' in ctx) return ctx

  const { data: doc } = await admin
    .from('org_documents')
    .select('id')
    .eq('id', documentId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  if (!doc) return { error: 'Documento não encontrado.' }

  const { error } = await admin
    .from('org_documents')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', documentId)
  if (error) return { error: 'Erro ao publicar.' }

  revalidatePath('/admin/notificacoes/documentos')
  return {}
}

export async function archiveDocument(documentId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const ctx = await requireAdminOrg(admin)
  if ('error' in ctx) return ctx

  const { data: doc } = await admin
    .from('org_documents')
    .select('id')
    .eq('id', documentId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  if (!doc) return { error: 'Documento não encontrado.' }

  const { error } = await admin
    .from('org_documents')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', documentId)
  if (error) return { error: 'Erro ao arquivar.' }

  revalidatePath('/admin/notificacoes/documentos')
  return {}
}

/**
 * Edita título/conteúdo de um documento. Toda edição cria uma versão nova.
 *
 * Se o documento está `published` e alguém já confirmou a versão corrente, a
 * escolha de `mode` é obrigatória — sem ela, devolve `needsModeChoice` com o
 * número de pessoas afetadas para o admin decidir na hora (nenhuma escrita
 * acontece até a escolha chegar).
 */
export async function updateDocument(
  documentId: string,
  input: { title: string; body: string; mode?: EditMode },
): Promise<{ error?: string; needsModeChoice?: boolean; affectedCount?: number }> {
  const admin = createAdminClient()
  const ctx = await requireAdminOrg(admin)
  if ('error' in ctx) return ctx

  const invalid = validateInput(input.title, input.body)
  if (invalid) return { error: invalid }

  const { data: doc } = await admin
    .from('org_documents')
    .select('id, status, current_version')
    .eq('id', documentId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  if (!doc) return { error: 'Documento não encontrado.' }

  const { data: previousAcksRaw } = await admin
    .from('org_document_acks')
    .select('user_id, signed_name, signed_cpf, covered_dependents, ip_address, user_agent, acked_at')
    .eq('document_id', documentId)
    .eq('version', doc.current_version)

  const previousAcks: ExistingAck[] = (
    (previousAcksRaw ?? []) as {
      user_id: string
      signed_name: string | null
      signed_cpf: string | null
      covered_dependents: unknown
      ip_address: string | null
      user_agent: string | null
      acked_at: string
    }[]
  ).map((a) => ({
    userId: a.user_id,
    signedName: a.signed_name,
    signedCpf: a.signed_cpf,
    coveredDependents: a.covered_dependents,
    ipAddress: a.ip_address,
    userAgent: a.user_agent,
    ackedAt: a.acked_at,
  }))

  if (requiresEditModeChoice(doc.status, previousAcks.length) && !input.mode) {
    return { needsModeChoice: true, affectedCount: previousAcks.length }
  }

  const newVersion = doc.current_version + 1

  const { error: versionError } = await admin.from('org_document_versions').insert({
    document_id: documentId,
    version: newVersion,
    body: input.body.trim(),
    created_by: ctx.userId,
  })
  if (versionError) return { error: 'Erro ao salvar o conteúdo.' }

  const toCarry = carryForwardAcks(input.mode ?? 'content_change', previousAcks)
  if (toCarry.length > 0) {
    const { error: ackError } = await admin.from('org_document_acks').upsert(
      toCarry.map((a) => ({
        organization_id: ctx.orgId,
        document_id: documentId,
        version: newVersion,
        user_id: a.userId,
        acked_at: a.ackedAt,
        ip_address: a.ipAddress,
        user_agent: a.userAgent,
        signed_name: a.signedName,
        signed_cpf: a.signedCpf,
        covered_dependents: a.coveredDependents,
      })),
      { onConflict: 'user_id,document_id,version', ignoreDuplicates: true },
    )
    if (ackError) return { error: 'Erro ao preservar as confirmações anteriores.' }
  }

  const { error: docError } = await admin
    .from('org_documents')
    .update({ title: input.title.trim(), current_version: newVersion, updated_at: new Date().toISOString() })
    .eq('id', documentId)
  if (docError) return { error: 'Erro ao salvar o documento.' }

  revalidatePath('/admin/notificacoes/documentos')
  return {}
}
