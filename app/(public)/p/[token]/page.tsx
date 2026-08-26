// app/(public)/p/[token]/page.tsx
// Link pessoal de pagamento de UMA inscrição de torneio (features/torneios/
// entryPaymentActions.ts gera o token). Público de propósito: quem paga pode
// ser o parceiro que acabou de aceitar um convite e ainda não tem sessão
// nesta aba — a autenticação é o próprio token na URL.
import { notFound } from 'next/navigation'
import { getPublicEntryPayment } from '@/features/torneios/entryPaymentActions'
import { EntryPaymentCard } from './EntryPaymentCard'

export const dynamic = 'force-dynamic'

interface PageProps { params: { token: string } }

export default async function EntryPaymentPage({ params }: PageProps) {
  const data = await getPublicEntryPayment(params.token)
  if (!data) notFound()

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
      <div className="rounded-2xl border border-surface-border bg-surface-card p-6">
        <div className="mb-4 text-center">
          <div className="text-3xl mb-2">💳</div>
          <h1 className="text-lg font-semibold text-white">{data.tournamentName}</h1>
          {data.payeeName && <p className="mt-1 text-sm text-slate-400">Inscrição de {data.payeeName}</p>}
        </div>
        <EntryPaymentCard token={params.token} data={data} />
      </div>
    </div>
  )
}
