'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plug } from 'lucide-react'
import {
  connectIntegration,
  disconnectIntegration,
  resolvePendingCheckin,
} from '@/features/checkin/actions'
import type { OrgIntegrationView, PendingCheckin } from '@/types'

interface Props {
  wellhub: OrgIntegrationView | null
  pending: PendingCheckin[]
  students: { id: string; full_name: string }[]
  webhookUrl: string
}

export function IntegracoesClient({ wellhub, pending, students, webhookUrl }: Props) {
  const router = useRouter()
  const [gymId, setGymId] = useState(wellhub?.gym_id ?? '')
  const [secret, setSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>(
    wellhub?.environment ?? 'production',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const connected = wellhub?.status === 'connected'

  async function handleSave() {
    setError('')
    setSaving(true)
    const res = await connectIntegration('wellhub', {
      gymId,
      webhookSecret: secret,
      apiKey,
      environment,
    })
    setSaving(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setSecret('')
    setApiKey('')
    router.refresh()
  }

  async function handleDisconnect() {
    setSaving(true)
    await disconnectIntegration('wellhub')
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Integrações</h1>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Wellhub</h2>
          <Badge variant={connected ? 'success' : 'default'}>
            {connected ? 'Conectado' : 'Desconectado'}
          </Badge>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Informe à Wellhub esta URL de webhook para receber os check-ins:
        </p>
        <code className="block text-xs bg-surface border border-surface-border rounded-lg px-3 py-2 text-brand-400 mb-4 break-all">
          {webhookUrl}
        </code>

        <div className="space-y-3">
          <Input label="Gym ID (Wellhub)" value={gymId} onChange={(e) => setGymId(e.target.value)} />
          <Input
            label="Webhook secret"
            type="password"
            placeholder={wellhub ? '••••••• (preencha para alterar)' : ''}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <Input
            label="API key (Access Control — valida e gera pagamento)"
            type="password"
            placeholder={wellhub?.has_api_key ? '••••••• (preencha para alterar)' : ''}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div>
            <label className="block text-sm text-slate-300 mb-1">Ambiente</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
              className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
            >
              <option value="production">Produção</option>
              <option value="sandbox">Sandbox (testes)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSave} loading={saving} disabled={!gymId || !secret}>
              {wellhub ? 'Salvar' : 'Conectar'}
            </Button>
            {connected && (
              <Button variant="ghost" onClick={handleDisconnect} loading={saving}>
                Desconectar
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white mb-4">Check-ins pendentes</h2>
        {pending.length === 0 ? (
          <EmptyState icon={Plug} title="Nenhum check-in pendente." description="Check-ins cujo ID não casou com um aluno aparecem aqui." />
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <PendingRow key={p.id} pending={p} students={students} onResolved={() => router.refresh()} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function PendingRow({
  pending,
  students,
  onResolved,
}: {
  pending: PendingCheckin
  students: { id: string; full_name: string }[]
  onResolved: () => void
}) {
  const [studentId, setStudentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleLink() {
    if (!studentId) return
    setError('')
    setBusy(true)
    const res = await resolvePendingCheckin(pending.id, studentId)
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    onResolved()
  }

  return (
    <div className="border border-surface-border rounded-lg p-3 space-y-2">
      <div className="text-sm text-white">
        ID <span className="text-brand-400">{pending.partner_member_id}</span> ·{' '}
        <span className="text-slate-400">{pending.checkin_date}</span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="flex-1 min-w-48 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
        >
          <option value="">Selecione um aluno…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <Button onClick={handleLink} loading={busy} disabled={!studentId} size="sm">
          Vincular
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
