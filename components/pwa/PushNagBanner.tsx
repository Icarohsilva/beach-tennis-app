'use client'
// components/pwa/PushNagBanner.tsx
// Faixa que insiste na permissão de notificação. Por decisão de produto não tem
// botão de fechar: some sozinha quando a permissão é concedida. Tom leve, sem
// cara de erro — quem se irrita com o aviso não instala o app.
import { useState } from 'react'
import Link from 'next/link'
import { Bell, BellOff } from 'lucide-react'
import { subscribeToPush } from '@/lib/pwa/pushClient'

export function PushNagBanner({
  state,
  onGranted,
}: {
  state: 'push-ask' | 'push-blocked'
  onGranted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function ativar() {
    setBusy(true)
    setErro(null)
    const res = await subscribeToPush()
    setBusy(false)
    // Sucesso ou recusa, o ambiente mudou: recalcula (a faixa some se virou
    // 'granted', vira 'push-blocked' se a pessoa clicou em Bloquear).
    if (res.error) setErro(res.error)
    onGranted()
  }

  if (state === 'push-blocked') {
    return (
      <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-slate-600/40 bg-slate-500/10 px-3 py-2 text-xs text-slate-300">
        <BellOff className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          As notificações estão bloqueadas no navegador. Toque no cadeado 🔒 ao lado do endereço
          pra liberar.
        </span>
        <Link
          href="/ajuda/aluno#instale-o-app-no-seu-celular"
          className="shrink-0 font-semibold text-slate-200 underline underline-offset-2"
        >
          Como faço
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-brand-600/30 bg-brand-600/10 px-3 py-2 text-xs text-brand-100">
      <Bell className="h-4 w-4 shrink-0 text-brand-400" />
      <span className="min-w-0 flex-1">
        {erro ?? 'Tá faltando combinar o principal: aula cancelada, vaga na fila, lembrete de treino.'}
      </span>
      <button
        onClick={ativar}
        disabled={busy}
        className="shrink-0 rounded-md bg-gradient-to-r from-brand-600 to-brand-700 px-2.5 py-1 font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {busy ? '...' : 'Ativar'}
      </button>
    </div>
  )
}
