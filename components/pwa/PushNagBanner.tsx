'use client'
// components/pwa/PushNagBanner.tsx
// Faixa que insiste na permissão de notificação. Por decisão de produto não tem
// botão de fechar: some sozinha quando a permissão é concedida. Tom leve, sem
// cara de erro — quem se irrita com o aviso não instala o app.
import { useState } from 'react'
import Link from 'next/link'
import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { subscribeToPush } from '@/lib/pwa/pushClient'

export function PushNagBanner({
  state,
  onOutcome,
}: {
  state: 'push-ask' | 'push-blocked'
  // Dispara em qualquer desfecho — concedeu, negou ou falhou —, porque em todos
  // eles o ambiente mudou e o pai precisa recalcular a decisão.
  onOutcome: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function ativar() {
    setBusy(true)
    setErro(null)
    try {
      const res = await subscribeToPush()
      if (res.error) setErro(res.error)
    } finally {
      // requestPermission() e a server action de salvar ficam fora do try/catch
      // do pushClient, então podem lançar. Sem o finally o botão trava
      // desabilitado até a pessoa recarregar a página.
      setBusy(false)
    }
    // Concedeu, negou ou falhou: em todos os casos o pai recalcula (a faixa some
    // se virou 'granted', vira 'push-blocked' se a pessoa clicou em Bloquear).
    onOutcome()
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
      <Button onClick={ativar} loading={busy} size="sm" className="shrink-0">
        Ativar
      </Button>
    </div>
  )
}
