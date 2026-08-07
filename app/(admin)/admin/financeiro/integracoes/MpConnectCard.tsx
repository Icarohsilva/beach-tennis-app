'use client'
// app/(admin)/admin/financeiro/integracoes/MpConnectCard.tsx
import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { getMercadoPagoAuthUrl, disconnectMercadoPago } from '@/features/financeiro/gatewayActions'

interface MpConnectCardProps {
  account: {
    status: 'connected' | 'disconnected' | 'expired'
    mpUserId: string | null
    tokenExpiresAt: string | null
  } | null
}

const CALLBACK_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Mercado Pago conectado com sucesso!', ok: true },
  invalid: { text: 'Link de autorização inválido ou expirado. Tente de novo.', ok: false },
  forbidden: { text: 'Apenas o dono da academia pode conectar o Mercado Pago.', ok: false },
  error: { text: 'Não foi possível concluir a conexão. Tente novamente.', ok: false },
}

export function MpConnectCard({ account }: MpConnectCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Captura o feedback do retorno do OAuth uma única vez (estado local) e
  // limpa o ?mp= da URL logo em seguida — sem isso, um refresh/voltar do
  // navegador reexibiria "conectado com sucesso!" mesmo que a conta tenha
  // sido desconectada/expirado depois, contradizendo o badge (fonte real
  // de verdade, vinda do prop `account`).
  const [feedback] = useState(() => {
    const mpParam = searchParams.get('mp')
    return mpParam ? CALLBACK_MESSAGES[mpParam] : undefined
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const connected = account?.status === 'connected'
  const expired = account?.status === 'expired'

  useEffect(() => {
    if (searchParams.get('mp')) router.replace(pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleConnect() {
    setError(null)
    startTransition(async () => {
      const result = await getMercadoPagoAuthUrl()
      if (result.error || !result.url) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.url
    })
  }

  function handleDisconnect() {
    if (!confirm('Desconectar o Mercado Pago? Novos pagamentos pelo app ficarão indisponíveis.')) return
    setError(null)
    startTransition(async () => {
      const result = await disconnectMercadoPago()
      if (result.error) setError(result.error)
      else window.location.href = '/admin/financeiro/integracoes'
    })
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold">Mercado Pago</h3>
            {connected && <Badge variant="success">Conectado</Badge>}
            {expired && <Badge variant="danger">Conexão expirada</Badge>}
            {!account || account.status === 'disconnected' ? (
              <Badge variant="default">Não conectado</Badge>
            ) : null}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {connected
              ? `Conta MP ${account?.mpUserId ?? ''}. Os pagamentos dos alunos caem direto nela.`
              : 'Conecte a conta Mercado Pago da academia para vender planos, aula avulsa e day use pelo app.'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {connected ? (
            <Button size="sm" variant="ghost" loading={pending} onClick={handleDisconnect}>
              Desconectar
            </Button>
          ) : (
            <Button size="sm" variant="primary" loading={pending} onClick={handleConnect}>
              {expired ? 'Reconectar' : 'Conectar Mercado Pago'}
            </Button>
          )}
        </div>
      </div>
      {feedback && (
        <p
          className={
            feedback.ok
              ? 'mt-3 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2'
              : 'mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2'
          }
        >
          {feedback.text}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Card>
  )
}
