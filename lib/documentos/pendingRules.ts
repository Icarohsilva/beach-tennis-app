// lib/documentos/pendingRules.ts
// Regra pura: quais documentos de uma academia ainda bloqueiam este aluno.
//
// "Pendente" = published E sem ack do usuário na versão CORRENTE. Documento
// draft/archived nunca bloqueia. Ack de uma versão antiga não libera a nova —
// é o que faz o admin conseguir forçar reassinatura ao publicar uma "mudança de
// conteúdo" (basta bumpar current_version; quem já assinou a versão anterior
// volta a aparecer aqui). Ack de outro documento não interfere neste, porque a
// chave de comparação é sempre o par (documentId, version).
//
// Puro, sem I/O, no padrão de accessRules.ts: o caller (features/documentos/
// pendingQuery.ts) busca no banco e aqui só se decide o que fica pendente.
export interface OrgDocumentSummary {
  id: string
  title: string
  kind: 'ack' | 'sign'
  status: 'draft' | 'published' | 'archived'
  currentVersion: number
}

export interface AckSummary {
  documentId: string
  version: number
}

function ackKey(documentId: string, version: number): string {
  return `${documentId}:${version}`
}

export function selectPendingDocuments(
  documents: OrgDocumentSummary[],
  acks: AckSummary[],
): OrgDocumentSummary[] {
  const acked = new Set(acks.map((a) => ackKey(a.documentId, a.version)))
  return documents.filter(
    (d) => d.status === 'published' && !acked.has(ackKey(d.id, d.currentVersion)),
  )
}
