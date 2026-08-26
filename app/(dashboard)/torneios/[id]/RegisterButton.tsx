'use client'
// app/(dashboard)/torneios/[id]/RegisterButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { registerForTournament } from '@/features/torneios/actions'
import { inviteTournamentPartner } from '@/features/torneios/partnerInviteActions'

interface RegisterButtonProps {
  tournamentId: string
  participantType: string
  potentialPartners: { id: string; full_name: string }[]
}

type PartnerMode = 'existing' | 'invite'

export function RegisterButton({ tournamentId, participantType, potentialPartners }: RegisterButtonProps) {
  const [partnerMode, setPartnerMode] = useState<PartnerMode>('existing')
  const [partnerId, setPartnerId] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; whatsappUrl: string } | null>(null)
  const [chargeResult, setChargeResult] = useState<{ whatsappUrl?: string; paymentUrl?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const needsPartner = participantType === 'dupla_fixa'

  function handleRegisterExisting() {
    setError(null)
    startTransition(async () => {
      const res = await registerForTournament(tournamentId, needsPartner ? partnerId || undefined : undefined)
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.partnerPaymentUrl) {
        // Parceiro já tem conta mas ainda não pagou a parte dele — quem
        // inscreveu precisa conseguir avisar e mandar o link, não só torcer
        // para o parceiro descobrir sozinho.
        setChargeResult({ whatsappUrl: res.partnerWhatsappUrl, paymentUrl: res.partnerPaymentUrl })
      } else {
        router.refresh()
      }
    })
  }

  function handleInvite() {
    setError(null)
    startTransition(async () => {
      const res = await inviteTournamentPartner(tournamentId, { name: inviteName, phone: invitePhone })
      if (res.error) {
        setError(res.error)
        return
      }
      setInviteResult({ inviteUrl: res.inviteUrl!, whatsappUrl: res.whatsappUrl! })
    })
  }

  if (inviteResult) {
    return (
      <div className="space-y-2 rounded-lg border border-surface-border bg-surface p-3">
        <p className="text-sm text-white">
          ✓ Você está inscrito. Falta seu parceiro confirmar.
        </p>
        <a
          href={inviteResult.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg bg-green-700 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-green-600"
        >
          📱 Enviar convite pelo WhatsApp
        </a>
      </div>
    )
  }

  if (chargeResult) {
    return (
      <div className="space-y-2 rounded-lg border border-surface-border bg-surface p-3">
        <p className="text-sm text-white">
          ✓ Você está inscrito. Falta seu parceiro pagar a parte dele.
        </p>
        {chargeResult.whatsappUrl ? (
          <a
            href={chargeResult.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-lg bg-green-700 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-green-600"
          >
            📱 Enviar link de pagamento pelo WhatsApp
          </a>
        ) : (
          <p className="text-xs text-slate-400 break-all">{chargeResult.paymentUrl}</p>
        )}
        <button
          onClick={() => router.refresh()}
          className="text-xs text-brand-400 hover:text-brand-300"
        >
          Ok, entendi
        </button>
      </div>
    )
  }

  if (needsPartner && partnerMode === 'invite') {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setPartnerMode('existing')}
          className="text-xs text-brand-400 hover:text-brand-300"
        >
          ← Escolher parceiro que já tem conta
        </button>
        <input
          type="text"
          value={inviteName}
          onChange={(e) => setInviteName(e.target.value)}
          placeholder="Nome do parceiro"
          className="w-full rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <input
          type="tel"
          value={invitePhone}
          onChange={(e) => setInvitePhone(e.target.value)}
          placeholder="Telefone (WhatsApp)"
          className="w-full rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <Button loading={isPending} onClick={handleInvite} disabled={!inviteName.trim() || !invitePhone.trim()}>
          Inscrever e convidar
        </Button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {needsPartner && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Selecione seu parceiro</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">Selecione...</option>
            {potentialPartners.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <button
            onClick={() => setPartnerMode('invite')}
            className="mt-1 text-xs text-brand-400 hover:text-brand-300"
          >
            Meu parceiro ainda não tem conta — convidar por WhatsApp
          </button>
        </div>
      )}
      <Button
        loading={isPending}
        onClick={handleRegisterExisting}
        disabled={needsPartner && !partnerId}
      >
        Inscrever-se
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
