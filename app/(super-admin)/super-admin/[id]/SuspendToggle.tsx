'use client'
// app/(super-admin)/super-admin/[id]/SuspendToggle.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { suspendOrganization, reactivateOrganization } from '@/features/super-admin/actions'

export function SuspendToggle({
  orgId,
  status,
}: {
  orgId: string
  status: 'active' | 'suspended'
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const suspended = status === 'suspended'

  function act() {
    setError(null)
    startTransition(async () => {
      const res = suspended
        ? await reactivateOrganization(orgId)
        : await suspendOrganization(orgId)
      if (res.error) setError(res.error)
      else {
        setConfirming(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-300">
            {suspended
              ? 'Reativar esta academia? Os usuários voltam a ter acesso.'
              : 'Suspender esta academia? Todos os usuários dela perdem acesso.'}
          </span>
          <Button size="sm" loading={isPending} onClick={act}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant={suspended ? 'secondary' : 'danger'}
          onClick={() => setConfirming(true)}
        >
          {suspended ? 'Reativar academia' : 'Suspender academia'}
        </Button>
      )}
    </div>
  )
}
