'use client'
// app/(admin)/admin/notificacoes/documentos/DocumentosClient.tsx
// Lista + editor de termos/comunicados obrigatórios. Um só componente porque o
// fluxo é curto (poucos documentos por academia) e o admin alterna entre ver a
// lista e editar um item o tempo todo — duas telas separadas só trocariam
// idas e vindas por navegação de página.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { FileText, Plus, ArrowLeft, Eye } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import { DocumentGate } from '@/features/documentos/DocumentGate'
import { createDocument, updateDocument, publishDocument, archiveDocument } from '@/features/documentos/adminActions'
import type { OrgDocumentRow } from '@/features/documentos/adminQuery'
import type { EditMode } from '@/lib/documentos/versioningRules'

const STATUS_LABEL: Record<OrgDocumentRow['status'], string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
}

const STATUS_VARIANT: Record<OrgDocumentRow['status'], 'default' | 'success' | 'warning'> = {
  draft: 'warning',
  published: 'success',
  archived: 'default',
}

type Editing = { mode: 'new' } | { mode: 'edit'; doc: OrgDocumentRow } | null

export function DocumentosClient({ initialDocuments }: { initialDocuments: OrgDocumentRow[] }) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [editing, setEditing] = useState<Editing>(null)

  function upsertLocal(row: OrgDocumentRow) {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === row.id)
      return exists ? prev.map((d) => (d.id === row.id ? row : d)) : [row, ...prev]
    })
  }

  if (editing) {
    return (
      <DocumentEditor
        initial={editing.mode === 'edit' ? editing.doc : null}
        onCancel={() => setEditing(null)}
        onSaved={(row) => {
          upsertLocal(row)
          setEditing(null)
        }}
      />
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Termos e comunicados obrigatórios</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Documentos que o aluno é obrigado a ler (e, quando marcado, assinar) antes de usar o app.
          </p>
        </div>
        <Button onClick={() => setEditing({ mode: 'new' })}>
          <Plus size={16} className="mr-2" />
          Novo
        </Button>
      </div>

      {documents.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FileText size={32} className="text-slate-600" />
            <p className="text-sm text-slate-400">Nenhum documento criado ainda.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onEdit={() => setEditing({ mode: 'edit', doc })}
              onPublish={async () => {
                const res = await publishDocument(doc.id)
                if (!res.error) {
                  upsertLocal({ ...doc, status: 'published', publishedAt: new Date().toISOString() })
                }
              }}
              onArchive={async () => {
                const res = await archiveDocument(doc.id)
                if (!res.error) upsertLocal({ ...doc, status: 'archived' })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentRow({
  doc,
  onEdit,
  onPublish,
  onArchive,
}: {
  doc: OrgDocumentRow
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
            <Badge>{doc.kind === 'sign' ? 'Ler + assinar' : 'Só ler'}</Badge>
            <span className="text-xs text-slate-500">v{doc.currentVersion}</span>
          </div>
          <p className="mt-1 truncate font-semibold text-white">{doc.title}</p>
          {doc.status !== 'draft' && (
            <p className="text-xs text-slate-400">
              {doc.ackedCount} de {doc.totalStudents} {doc.kind === 'sign' ? 'assinaram' : 'leram'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {doc.status !== 'draft' && (
            <Link
              href={`/admin/notificacoes/documentos/${doc.id}`}
              className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-300 hover:text-white hover:border-brand-600/50"
            >
              Ver detalhe
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Editar
          </Button>
          {doc.status === 'draft' && (
            <Button
              size="sm"
              loading={isPending}
              onClick={() => startTransition(onPublish)}
            >
              Publicar
            </Button>
          )}
          {doc.status === 'published' && (
            <Button variant="danger" size="sm" loading={isPending} onClick={() => startTransition(onArchive)}>
              Arquivar
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function DocumentEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: OrgDocumentRow | null
  onCancel: () => void
  onSaved: (row: OrgDocumentRow) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [kind, setKind] = useState<'ack' | 'sign'>(initial?.kind ?? 'ack')
  const [body, setBody] = useState(initial?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [modeChoice, setModeChoice] = useState<{ affectedCount: number } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [isPending, startTransition] = useTransition()

  function save(mode?: EditMode) {
    setError(null)
    if (!title.trim() || !body.trim()) {
      setError('Título e conteúdo são obrigatórios.')
      return
    }

    startTransition(async () => {
      if (initial) {
        const res = await updateDocument(initial.id, { title, body, mode })
        if (res.needsModeChoice) {
          setModeChoice({ affectedCount: res.affectedCount ?? 0 })
          return
        }
        if (res.error) { setError(res.error); return }
        onSaved({
          ...initial,
          title: title.trim(),
          body: body.trim(),
          currentVersion: initial.currentVersion + 1,
          ackedCount: mode === 'correction' ? initial.ackedCount : 0,
        })
      } else {
        const res = await createDocument({ title, kind, body })
        if (res.error || !res.id) { setError(res.error ?? 'Erro ao criar documento.'); return }
        onSaved({
          id: res.id,
          title: title.trim(),
          kind,
          status: 'draft',
          currentVersion: 1,
          body: body.trim(),
          updatedAt: new Date().toISOString(),
          publishedAt: null,
          ackedCount: 0,
          totalStudents: 0,
        })
      }
    })
  }

  if (showPreview) {
    return (
      <DocumentGate
        docs={[{ id: 'preview', title: title || 'Sem título', kind, version: 1, body }]}
        preview
        onClosePreview={() => setShowPreview(false)}
      />
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button onClick={onCancel} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft size={16} />
          Voltar
        </button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!body.trim()}
          onClick={() => setShowPreview(true)}
        >
          <Eye size={16} className="mr-2" />
          Visualizar como o aluno
        </Button>
      </div>

      <h1 className="text-2xl font-bold text-white">{initial ? 'Editar documento' : 'Novo documento'}</h1>

      {modeChoice && (
        <Card className="border-yellow-500/40">
          <div className="space-y-3">
            <p className="text-sm text-white">
              {modeChoice.affectedCount === 0
                ? 'Ninguém confirmou a versão atual ainda — pode salvar sem escolher nada.'
                : `${modeChoice.affectedCount} ${modeChoice.affectedCount === 1 ? 'pessoa já confirmou' : 'pessoas já confirmaram'} a versão atual. O que fazer com a edição?`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="sm" variant="secondary" onClick={() => { setModeChoice(null); save('correction') }}>
                Correção — mantém quem já confirmou
              </Button>
              <Button size="sm" variant="danger" onClick={() => { setModeChoice(null); save('content_change') }}>
                Mudança de conteúdo — todos confirmam de novo
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <Card>
        <div className="space-y-4">
          <Input
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Termo de responsabilidade"
            disabled={isPending}
          />

          {!initial && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">Tipo</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setKind('ack')}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${kind === 'ack' ? 'border-brand-600 bg-brand-600/20 text-brand-400' : 'border-surface-border text-slate-400 hover:text-white'}`}
                >
                  Só marcar como lido
                </button>
                <button
                  onClick={() => setKind('sign')}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${kind === 'sign' ? 'border-brand-600 bg-brand-600/20 text-brand-400' : 'border-surface-border text-slate-400 hover:text-white'}`}
                >
                  Ler e assinar (CPF + nome)
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Conteúdo (markdown)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'## Título\n\nTexto do documento…'}
              rows={12}
              disabled={isPending}
              className="w-full resize-none rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
            />
          </div>

          {body.trim() && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Pré-visualização</p>
              <div className="rounded-xl border border-surface-border bg-surface p-4">
                <MarkdownDoc content={body} />
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save()} disabled={isPending} loading={isPending} size="lg">
          Salvar
        </Button>
      </div>
    </div>
  )
}
