'use server'
// features/documentos/actions.ts
// Registro de leitura/assinatura de um org_document pelo aluno — o outro lado
// do gate em DocumentGate.tsx.
import { headers } from 'next/headers'
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { isValidCPF, onlyDigits } from '@/lib/validation/documento'
import { listGuardianDependents } from '@/features/aulas/guardianQueries'

interface Signature {
  name: string
  cpf: string
}

/**
 * Registra o aluno logado como tendo lido (e, quando `kind='sign'`, assinado)
 * a versão CORRENTE do documento. Idempotente pelo unique
 * (user_id, document_id, version) de org_document_acks.
 *
 * `covered_dependents` é gravado sempre que o responsável tem dependentes —
 * decisão do produto: "o responsável assina 1x só" cobre ele e todos os filhos
 * de uma vez, e o snapshot é o que deixa registrado QUEM exatamente foi coberto
 * naquele momento (um dependente que saia da academia depois não apaga essa prova).
 */
export async function acknowledgeDocument(
  documentId: string,
  signature?: Signature,
): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()

  const { data: doc } = await admin
    .from('org_documents')
    .select('id, organization_id, kind, status, current_version')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc) return { error: 'Documento não encontrado.' }
  // Confere a org do documento contra a academia ATIVA do request (não a do
  // client) — o mesmo cuidado de IDOR de acceptLegalDocuments, adaptado: aqui
  // não há "conta recente" a considerar porque o aluno já está autenticado.
  if (doc.organization_id !== orgId) return { error: 'Documento não pertence a esta academia.' }
  if (doc.status !== 'published') return { error: 'Documento não está disponível.' }

  let signedName: string | null = null
  let signedCpf: string | null = null

  if (doc.kind === 'sign') {
    const name = signature?.name.trim() ?? ''
    if (name.length < 3) return { error: 'Informe o nome completo.' }
    const cpfDigits = onlyDigits(signature?.cpf ?? '')
    if (!isValidCPF(cpfDigits)) return { error: 'CPF inválido.' }
    signedName = name
    signedCpf = cpfDigits
  }

  const dependents = await listGuardianDependents()

  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = h.get('user-agent') || null

  const { error } = await admin.from('org_document_acks').upsert(
    {
      organization_id: orgId,
      document_id: documentId,
      version: doc.current_version,
      user_id: user.id,
      ip_address: ip,
      user_agent: userAgent,
      signed_name: signedName,
      signed_cpf: signedCpf,
      covered_dependents: dependents.length > 0 ? dependents : null,
    },
    { onConflict: 'user_id,document_id,version', ignoreDuplicates: true },
  )

  if (error) return { error: 'Erro ao registrar. Tente novamente.' }
  return {}
}
