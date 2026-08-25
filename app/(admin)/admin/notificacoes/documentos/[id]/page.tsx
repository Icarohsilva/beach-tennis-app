// app/(admin)/admin/notificacoes/documentos/[id]/page.tsx
// Detalhe de um documento: quem já leu/assinou e quem ainda está pendente.
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { getOrgDocumentDetail } from '@/features/documentos/adminQuery'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDocument } from '@/lib/validation/documento'

interface Props {
  params: { id: string }
}

export default async function DocumentoDetailPage({ params }: Props) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const orgId = await getActiveOrgId()
  if (!orgId) notFound()

  const detail = await getOrgDocumentDetail(createAdminClient(), { orgId, documentId: params.id })
  if (!detail) notFound()

  const ackedLabel = detail.kind === 'sign' ? 'Assinaram' : 'Leram'
  const acked = detail.students.filter((s) => s.acked)
  const pending = detail.students.filter((s) => !s.acked)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/admin/notificacoes/documentos" className="flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={16} />
        Voltar
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{detail.kind === 'sign' ? 'Ler + assinar' : 'Só ler'}</Badge>
          <span className="text-xs text-slate-500">v{detail.currentVersion}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-white">{detail.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {acked.length} de {detail.students.length} {ackedLabel.toLowerCase()}
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white">{ackedLabel} ({acked.length})</h2>
        {acked.length === 0 ? (
          <p className="text-sm text-slate-500">Ninguém ainda.</p>
        ) : (
          <div className="space-y-2">
            {acked.map((s) => (
              <div key={s.userId} className="flex flex-col gap-0.5 border-b border-surface-border/50 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-white">{s.name || 'Sem nome'}</span>
                <span className="text-xs text-slate-400">
                  {s.ackedAt && new Date(s.ackedAt).toLocaleString('pt-BR')}
                  {s.signedName && (
                    <> — assinado por <strong className="text-slate-300">{s.signedName}</strong>{s.signedCpf && ` (${formatDocument(s.signedCpf)})`}</>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-white">Pendentes ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Todo mundo confirmou.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pending.map((s) => (
              <span key={s.userId} className="rounded-lg border border-surface-border px-2 py-1 text-xs text-slate-400">
                {s.name || 'Sem nome'}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
