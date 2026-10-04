'use client'
// app/(admin)/admin/configuracoes/AppCheckinForm.tsx
// Liga o check-in Wellhub pelo app (com print) nesta arena.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { setAppCheckinEnabled } from '@/features/checkin/appCheckinActions'

interface Props {
  enabled: boolean
  /** Integração Wellhub conectada: o check-in já chega sozinho e a chave fica sem efeito. */
  integrationConnected: boolean
}

export function AppCheckinForm({ enabled: initial, integrationConnected }: Props) {
  const [enabled, setEnabled] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const r = await setAppCheckinEnabled(enabled)
      if (r.error) setError(r.error)
      else setSuccess('Configuração salva.')
    })
  }

  return (
    <Card className="space-y-3">
      {integrationConnected && (
        <p className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          A integração com o Wellhub está conectada: o check-in dos alunos já chega
          automaticamente, e esta opção fica sem efeito enquanto ela estiver ligada.
        </p>
      )}
      <Checkbox
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        label="Permitir check-in Wellhub pelo app, com o print do Wellhub"
      />
      <p className="text-xs text-slate-400">
        O aluno do plano Wellhub ganha na tela inicial o botão &quot;Fazer check-in&quot;, que
        exige o print da tela do Wellhub. É um check-in por dia: ele marca presença na aula
        reservada e conta na meta do mês. O print é lido automaticamente: precisa ser a tela
        &quot;Check-in confirmado&quot; de hoje, posterior ao último comprovante do aluno, e não pode
        ser repetido. Os prints ficam em{' '}
        <Link href="/admin/wellhub" className="text-brand-400 hover:text-brand-300">
          Wellhub
        </Link>
        , onde você confere e exclui o que não bater.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}
      <Button size="sm" onClick={save} loading={pending}>
        Salvar
      </Button>
    </Card>
  )
}
