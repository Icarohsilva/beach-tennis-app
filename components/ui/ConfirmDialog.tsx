'use client'
// components/ui/ConfirmDialog.tsx
// A confirmação padrão do app.
//
// Existe porque `window.confirm` quebra a tela em dois sentidos: ele é do
// sistema operacional (fonte, cor e botões do Chrome, com "www.arenahub.website
// diz" no cabeçalho) e não deixa formatar nada — nem negrito no valor, nem cor
// no botão destrutivo. Toda confirmação do app passa a sair daqui.
//
// Usa o mesmo casco de SessionModal: overlay com blur, `glass`, cantos 3xl e
// sombra. `useConfirm` guarda o pedido em estado e resolve a promise no clique:
// `const { ok, text } = await confirm({...})`.
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

export interface ConfirmRequest {
  title: string
  /** Corpo. Quebras de linha viram parágrafos. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Ação destrutiva pinta o botão de vermelho. */
  destructive?: boolean
  /**
   * Pede um texto junto da confirmação (motivo, observação). Substitui o
   * `window.prompt`, que tem a mesma cara de sistema operacional do `confirm` e
   * não deixa explicar para que serve o campo.
   */
  input?: { label: string; placeholder?: string; required?: boolean }
}

export function ConfirmDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest
  onConfirm: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <button
        type="button"
        aria-label="Cancelar"
        onClick={onCancel}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative w-full max-w-sm rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          {request.destructive && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="text-base font-extrabold text-white">
              {request.title}
            </h2>
            {request.message && (
              <div className="mt-1 space-y-1.5">
                {request.message.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i} className="text-sm text-slate-300">{line}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        {request.input && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-slate-400">{request.input.label}</span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.input.placeholder}
              className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            />
          </label>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            {request.cancelLabel ?? 'Voltar'}
          </Button>
          <Button
            variant={request.destructive ? 'danger' : 'primary'}
            className="flex-1"
            disabled={Boolean(request.input?.required) && !text.trim()}
            onClick={() => onConfirm(text.trim())}
          >
            {request.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * `const { confirm, dialog } = useConfirm()` — chame
 * `const { ok, text } = await confirm({...})` e renderize `{dialog}` no fim do
 * componente.
 *
 * A promise fica guardada num ref porque o clique acontece num render seguinte:
 * resolver direto no estado perderia o resolvedor entre renders.
 */
export interface ConfirmResult {
  ok: boolean
  /** Texto digitado, quando o pedido tinha `input`. */
  text: string
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null)

  const confirm = useCallback((req: ConfirmRequest) => {
    setRequest(req)
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function settle(r: ConfirmResult) {
    setRequest(null)
    resolver.current?.(r)
    resolver.current = null
  }

  const dialog = request ? (
    <ConfirmDialog
      // A chave zera o estado interno (o campo de texto) entre pedidos: sem
      // ela, o motivo digitado numa recusa reaparecia na seguinte.
      key={request.title}
      request={request}
      onConfirm={(text) => settle({ ok: true, text })}
      onCancel={() => settle({ ok: false, text: '' })}
    />
  ) : null

  return { confirm, dialog }
}
