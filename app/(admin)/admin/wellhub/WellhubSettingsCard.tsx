'use client'
// app/(admin)/admin/wellhub/WellhubSettingsCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateMissedCheckinSettings } from '@/features/checkin/missedCheckinActions'

interface Props {
  blockLimit: number
  price: number
  /** Valor do repasse por parceiro, mostrado como referência do fallback. */
  partnerRates: { wellhub: number; totalpass: number }
}

export function WellhubSettingsCard({ blockLimit, price, partnerRates }: Props) {
  const [limit, setLimit] = useState(String(blockLimit))
  const [value, setValue] = useState(price > 0 ? price.toFixed(2) : '0')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const parsedLimit = parseInt(limit, 10)
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      setError('O limite de pendências deve ser um número inteiro não-negativo.')
      return
    }
    const parsedPrice = parseFloat(value.replace(',', '.'))
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setError('O valor da pendência não pode ser negativo.')
      return
    }

    start(async () => {
      const r = await updateMissedCheckinSettings({
        blockLimit: parsedLimit,
        price: parsedPrice,
      })
      if (r.error) setError(r.error)
      else setSuccess('Configurações salvas.')
    })
  }

  const parsedLimit = parseInt(limit, 10)
  const blockOff = isNaN(parsedLimit) || parsedLimit <= 0

  return (
    <Card>
      <h2 className="text-sm font-semibold text-white mb-3">Regras de pendência</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            Bloquear aluno com quantas pendências?
          </label>
          <p className="text-xs text-slate-400">
            Ao atingir esse número de check-ins em aberto, o aluno para de conseguir
            agendar aula, deixa de ser vinculado na geração da grade, e as reservas
            futuras dele são canceladas — as vagas voltam para a fila de espera.
            Deixe <strong className="text-slate-300">0</strong> para não bloquear
            ninguém (as pendências continuam sendo registradas e cobradas).
          </p>
          <Input type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} />
          {blockOff ? (
            <p className="text-xs text-slate-500">Bloqueio desligado.</p>
          ) : (
            <p className="text-xs text-yellow-400">
              Bloqueio ativo a partir de {parsedLimit} pendência
              {parsedLimit !== 1 ? 's' : ''} em aberto.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300 font-medium">
            Valor cobrado por check-in não realizado (R$)
          </label>
          <p className="text-xs text-slate-400">
            Deixe <strong className="text-slate-300">0</strong> para cobrar o mesmo
            valor do repasse do parceiro, que você configura no Financeiro
            {' '}(Wellhub R$ {partnerRates.wellhub.toFixed(2).replace('.', ',')} · TotalPass
            R$ {partnerRates.totalpass.toFixed(2).replace('.', ',')}). Com os dois em 0
            a pendência é só controle, sem cobrança no app do aluno.
          </p>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar regras
        </Button>
      </form>
    </Card>
  )
}
