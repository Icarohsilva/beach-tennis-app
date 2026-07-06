'use client'
// app/(admin)/admin/financeiro/integracoes/GatewayRequestCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { requestGatewayIntegration } from '@/features/financeiro/gatewayActions'
import type { GatewayIntegrationRequest } from '@/types'

export function GatewayRequestCard({ requests }: { requests: GatewayIntegrationRequest[] }) {
  const router = useRouter()
  const [gatewayName, setGatewayName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await requestGatewayIntegration(gatewayName, notes)
      if (result.error) setError(result.error)
      else {
        setGatewayName('')
        setNotes('')
        setSuccess('Solicitação registrada! Vamos avaliar a integração.')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <h3 className="text-white font-semibold">Usa outro banco ou gateway?</h3>
      <p className="text-xs text-slate-400 mt-1 mb-3">
        Conte qual gateway a academia usa (Pagar.me, Asaas, Stripe, PagSeguro…) e avaliaremos a integração.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Banco/gateway *</label>
          <Input
            type="text"
            placeholder="Ex: Asaas"
            value={gatewayName}
            onChange={(e) => setGatewayName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Observações (opcional)</label>
          <Input
            type="text"
            placeholder="Ex: já uso cobrança recorrente por lá"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          disabled={!gatewayName.trim()}
          onClick={handleSubmit}
        >
          Enviar solicitação
        </Button>
      </div>

      {requests.length > 0 && (
        <div className="mt-4 pt-3 border-t border-surface-border space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Solicitações enviadas</p>
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span className="text-white">{r.gateway_name}</span>
              <Badge variant={r.status === 'reviewed' ? 'success' : 'warning'}>
                {r.status === 'reviewed' ? 'Avaliada' : 'Em análise'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
