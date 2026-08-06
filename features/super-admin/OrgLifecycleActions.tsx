'use client'
// features/super-admin/OrgLifecycleActions.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Gift, Power } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  extendTrial,
  reactivateOrganization,
  setCompedStatus,
  suspendOrganization,
} from '@/features/super-admin/actions'
import type { SubStatus } from '@/lib/superAdmin/metrics'

type Pending = 'trial' | 'comp' | 'suspend' | null

/**
 * Ações de ciclo de vida da conta, no mesmo lugar: estender trial, dar/tirar
 * cortesia e suspender/reativar. Toda ação aceita uma observação e vai para a
 * trilha de auditoria — mexer no acesso ou na cobrança de um cliente sempre
 * fica registrado com o porquê.
 */
export function OrgLifecycleActions({
  orgId,
  orgStatus,
  subStatus,
  isComped,
}: {
  orgId: string
  orgStatus: 'active' | 'suspended'
  subStatus: SubStatus
  isComped: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [running, setRunning] = useState<Pending>(null)
  const [confirming, setConfirming] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [okMessage, setOkMessage] = useState<string | null>(null)
  const [days, setDays] = useState(14)
  const [note, setNote] = useState('')

  const suspended = orgStatus === 'suspended'

  function run(which: Exclude<Pending, null>, fn: () => Promise<{ error?: string }>, success: string) {
    setError(null)
    setOkMessage(null)
    setRunning(which)
    startTransition(async () => {
      const res = await fn()
      setRunning(null)
      if (res.error) {
        setError(res.error)
        return
      }
      setConfirming(null)
      setNote('')
      setOkMessage(success)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {okMessage && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{okMessage}</p>
      )}

      <div>
        <label htmlFor="audit-note" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Observação (vai para a auditoria)
        </label>
        <input
          id="audit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: cliente pediu mais tempo para migrar a base"
          className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {/* Estender trial */}
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
        <CalendarPlus className="h-4 w-4 shrink-0 text-brand-400" />
        <span className="text-sm text-slate-300">Estender trial em</span>
        <input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Dias de extensão do trial"
          className="w-20 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-sm text-slate-300">dias</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending || subStatus === 'active'}
          loading={running === 'trial'}
          onClick={() =>
            run('trial', () => extendTrial(orgId, days, note), `Trial estendido em ${days} dias.`)
          }
        >
          Estender
        </Button>
        {subStatus === 'active' && (
          <span className="text-xs text-slate-500">Assinatura já ativa.</span>
        )}
      </div>

      {/* Cortesia */}
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
        <Gift className="h-4 w-4 shrink-0 text-violet-400" />
        <span className="text-sm text-slate-300">
          {isComped
            ? 'Conta em cortesia — acesso liberado, fora do MRR.'
            : 'Liberar acesso como cortesia (não entra no MRR).'}
        </span>
        {confirming === 'comp' ? (
          <>
            <Button
              size="sm"
              variant={isComped ? 'danger' : 'primary'}
              loading={running === 'comp'}
              onClick={() =>
                run(
                  'comp',
                  () => setCompedStatus(orgId, !isComped, note),
                  isComped ? 'Cortesia revogada — trial de 7 dias aberto.' : 'Cortesia concedida.',
                )
              }
            >
              Confirmar
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={isPending} onClick={() => setConfirming('comp')}>
            {isComped ? 'Revogar cortesia' : 'Dar cortesia'}
          </Button>
        )}
      </div>

      {/* Suspensão operacional */}
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
        <Power className="h-4 w-4 shrink-0 text-red-400" />
        {confirming === 'suspend' ? (
          <>
            <span className="text-sm text-slate-300">
              {suspended
                ? 'Reativar esta academia? Os usuários voltam a ter acesso.'
                : 'Suspender esta academia? Todos os usuários dela perdem acesso.'}
            </span>
            <Button
              size="sm"
              variant={suspended ? 'primary' : 'danger'}
              loading={running === 'suspend'}
              onClick={() =>
                run(
                  'suspend',
                  () =>
                    suspended
                      ? reactivateOrganization(orgId, note)
                      : suspendOrganization(orgId, note),
                  suspended ? 'Academia reativada.' : 'Academia suspensa.',
                )
              }
            >
              Confirmar
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-slate-300">
              {suspended ? 'Academia suspensa — sem acesso ao painel.' : 'Suspensão operacional imediata.'}
            </span>
            <Button
              size="sm"
              variant={suspended ? 'secondary' : 'danger'}
              disabled={isPending}
              onClick={() => setConfirming('suspend')}
            >
              {suspended ? 'Reativar academia' : 'Suspender academia'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
