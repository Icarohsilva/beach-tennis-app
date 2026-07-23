'use client'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSystemSettings } from '@/features/financeiro/actions'

interface Props {
  settings: { pix_key: string; pix_key_owner: string; debt_block_grace_days: number }
}

export function CobrancaForm({ settings }: Props) {
  const [pixKey, setPixKey] = useState(settings.pix_key)
  const [pixOwner, setPixOwner] = useState(settings.pix_key_owner)
  const [graceDays, setGraceDays] = useState(String(settings.debt_block_grace_days))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    start(async () => {
      const r = await updateSystemSettings({
        pix_key: pixKey.trim(),
        pix_key_owner: pixOwner.trim(),
        debt_block_grace_days: Number(graceDays),
      })
      if (r.error) setError(r.error)
      else setSuccess('Cobrança salva.')
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>}

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Chave PIX</label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="CPF, e-mail, telefone ou chave aleatória"
          />
          <p className="text-xs text-slate-400">
            Aparece para o aluno pagar uma aula avulsa por PIX e enviar o comprovante. Sem chave, essa opção não aparece.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Nome do beneficiário</label>
          <Input
            value={pixOwner}
            onChange={(e) => setPixOwner(e.target.value)}
            placeholder="Nome que aparece na chave PIX"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">Carência antes de bloquear (dias)</label>
          <Input
            type="number"
            min={0}
            max={90}
            value={graceDays}
            onChange={(e) => setGraceDays(e.target.value)}
          />
          <p className="text-xs text-slate-400">
            Dias que o aluno tem para pagar uma aula avulsa antes de ser impedido de agendar. 0 bloqueia na hora.
          </p>
        </div>

        <Button type="submit" variant="primary" loading={pending}>Salvar cobrança</Button>
      </form>
    </Card>
  )
}
