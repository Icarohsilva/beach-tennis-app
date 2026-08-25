'use client'
// features/documentos/DocumentGate.tsx
// Tela terminal exibida no lugar de {children} do layout do aluno quando há
// documento obrigatório pendente — mesmo desenho de SuspendedNotice (devolve a
// tela em vez de renderizar por trás, sem redirect). Deliberadamente SEM as
// quatro saídas do modal padrão da casa (Esc, clique fora, X, e o próprio
// scroll do body): a única saída é sair da conta.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { formatDocument, isValidCPF, onlyDigits } from '@/lib/validation/documento'
import { acknowledgeDocument } from './actions'
import type { PendingDocument } from './pendingQuery'

/** Distância do fundo (px) que já conta como "chegou ao fim" no fallback de rolagem. */
const BOTTOM_SLACK_PX = 24

interface DocumentGateProps {
  docs: PendingDocument[]
  /**
   * Modo visualização, usado pelo editor do admin (DocumentosClient.tsx) para
   * mostrar exatamente esta tela sem gravar nada de verdade: não chama
   * `acknowledgeDocument`, e a saída vira "Fechar visualização" em vez de logout.
   */
  preview?: boolean
  onClosePreview?: () => void
}

export function DocumentGate({ docs, preview = false, onClosePreview }: DocumentGateProps) {
  const router = useRouter()
  const [pending, setPending] = useState(docs)
  const [canConfirm, setCanConfirm] = useState(false)
  const [showSignFields, setShowSignFields] = useState(false)
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewDone, setPreviewDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const total = docs.length
  const current = pending[0] as PendingDocument | undefined

  // Reseta o estado de um documento para o próximo quando a fila anda.
  useEffect(() => {
    setCanConfirm(false)
    setShowSignFields(false)
    setName('')
    setCpf('')
    setError(null)
  }, [current?.id])

  // Sentinela no fim do texto: threshold 0 (rolagem rápida pode pular
  // thresholds maiores — ver app/_landing/Reveal.tsx) + fallback por evento de
  // rolagem, os dois ativos ao mesmo tempo. Nunca falha aberto (liberaria sem
  // ler) nem fechado (prenderia o aluno se IntersectionObserver faltasse).
  useEffect(() => {
    const container = scrollRef.current
    const sentinel = sentinelRef.current
    if (!container || !sentinel) return

    function markVisible() {
      setCanConfirm(true)
    }

    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && markVisible()),
        { root: container, threshold: 0 },
      )
      io.observe(sentinel)
    }

    function onScroll() {
      const atBottom =
        container!.scrollHeight - container!.scrollTop - container!.clientHeight < BOTTOM_SLACK_PX
      if (atBottom) markVisible()
    }
    container.addEventListener('scroll', onScroll)
    // Documento curto que não precisa rolar: já libera na primeira medição.
    onScroll()

    return () => {
      io?.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [current?.id])

  function advance() {
    setPending((prev) => {
      const next = prev.slice(1)
      // Sem próximo documento local: pede ao servidor para reavaliar — se não
      // houver mais pendência, o layout volta a renderizar o app de verdade.
      if (next.length === 0) router.refresh()
      return next
    })
  }

  async function handleAck() {
    if (!current) return
    if (preview) { setPreviewDone(true); return }
    setSubmitting(true)
    setError(null)
    const res = await acknowledgeDocument(current.id)
    setSubmitting(false)
    if (res.error) { setError(res.error); return }
    advance()
  }

  async function handleSign() {
    if (!current) return
    if (name.trim().length < 3) { setError('Informe o nome completo.'); return }
    const digits = onlyDigits(cpf)
    if (!isValidCPF(digits)) { setError('CPF inválido.'); return }
    if (preview) { setPreviewDone(true); return }
    setSubmitting(true)
    setError(null)
    const res = await acknowledgeDocument(current.id, { name: name.trim(), cpf: digits })
    setSubmitting(false)
    if (res.error) { setError(res.error); return }
    advance()
  }

  if (preview && previewDone) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-white">
        <p className="text-sm text-slate-300">
          É assim que o aluno veria depois de {current?.kind === 'sign' ? 'assinar' : 'confirmar a leitura'}.
        </p>
        <button
          onClick={onClosePreview}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Fechar visualização
        </button>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-surface text-white flex items-center justify-center p-6">
        <p className="text-sm text-slate-400">Carregando...</p>
      </div>
    )
  }

  const index = total - pending.length + 1

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface text-white">
      {preview && (
        <div className="shrink-0 bg-brand-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          Visualização — é assim que o aluno vê, nada é gravado aqui
        </div>
      )}
      <header className="shrink-0 border-b border-surface-border px-4 py-3">
        {total > 1 && (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Comunicado {index} de {total}
          </p>
        )}
        <h1 className="text-lg font-bold">{current.title}</h1>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <MarkdownDoc content={current.body} />
        <div ref={sentinelRef} className="h-px w-full" />
      </div>

      <footer className="shrink-0 space-y-3 border-t border-surface-border p-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {current.kind === 'sign' && showSignFields ? (
          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <input
              type="text"
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(formatDocument(e.target.value))}
              placeholder="CPF"
              className="w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <button
              onClick={handleSign}
              disabled={submitting}
              className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Assinando...' : 'Assinar'}
            </button>
          </div>
        ) : (
          <button
            onClick={current.kind === 'sign' ? () => setShowSignFields(true) : handleAck}
            disabled={!canConfirm || submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-surface-border disabled:text-slate-500"
          >
            {!canConfirm
              ? 'Role até o fim para continuar'
              : submitting
                ? 'Enviando...'
                : 'Li e estou ciente'}
          </button>
        )}

        {preview ? (
          <button
            onClick={onClosePreview}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-300"
          >
            Fechar visualização
          </button>
        ) : (
          <LogoutButton className="w-full text-center text-xs text-slate-500 hover:text-slate-300">
            Sair da conta
          </LogoutButton>
        )}
      </footer>
    </div>
  )
}
