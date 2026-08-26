// app/(public)/t/[id]/dupla/[token]/page.tsx
// A tela do convidado: "Fulano te convidou para jogar em dupla". Pública —
// quem recebe o link pelo WhatsApp pode não ter conta ainda.
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPartnerInvitePublicData } from '@/features/torneios/partnerInviteActions'
import { getAuthUser } from '@/lib/supabase/server'
import { AcceptInviteCard } from './AcceptInviteCard'

interface PageProps { params: { id: string; token: string } }

const STATE_MESSAGE: Record<'accepted' | 'declined' | 'expired', { title: string; body: string }> = {
  accepted: { title: 'Convite já aceito', body: 'Esta dupla já foi confirmada.' },
  declined: { title: 'Convite recusado', body: 'Este convite não está mais disponível.' },
  expired: { title: 'Convite expirado', body: 'Peça para a pessoa que te chamou enviar um novo convite.' },
}

export default async function PartnerInvitePage({ params }: PageProps) {
  const data = await getPartnerInvitePublicData(params.token)
  if (!data || data.tournamentId !== params.id) notFound()

  if (data.state !== 'pending') {
    const msg = STATE_MESSAGE[data.state]
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 text-center">
          <h1 className="text-lg font-semibold text-white">{msg.title}</h1>
          <p className="mt-2 text-sm text-slate-400">{msg.body}</p>
          <Link href={`/t/${params.id}`} className="mt-4 inline-block text-sm text-brand-400 hover:text-brand-300">
            ← Ver o torneio
          </Link>
        </div>
      </div>
    )
  }

  const user = await getAuthUser()

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
      <div className="rounded-2xl border border-surface-border bg-surface-card p-6">
        <div className="mb-4 text-center">
          <div className="text-3xl mb-2">🎾</div>
          <h1 className="text-lg font-semibold text-white">
            {data.registrantName} te convidou para jogar em dupla!
          </h1>
          <p className="mt-1 text-sm text-slate-400">{data.tournamentName}</p>
        </div>

        {user ? (
          <AcceptInviteCard token={params.token} needsGender={data.needsGender} tournamentId={params.id} />
        ) : (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-400">
              Entre ou crie sua conta para aceitar o convite.
            </p>
            <Link
              href={`/login?next=/t/${params.id}/dupla/${params.token}`}
              className="block w-full rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 py-3 text-center text-sm font-semibold text-white hover:from-orange-500 hover:to-orange-400"
            >
              Já tenho conta · Entrar
            </Link>
            <Link
              href={`/t/${params.id}/cadastrar?next=/t/${params.id}/dupla/${params.token}`}
              className="block w-full rounded-xl border border-surface-border bg-surface px-4 py-3 text-center text-sm font-medium text-white hover:bg-surface-border"
            >
              Criar conta e aceitar
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
