// features/torneios/MyEntryPaymentCard.tsx
// "Sua inscrição ainda não foi paga" na página do torneio do aluno logado.
//
// Sem isto, quem se inscreveu e fechou o checkout via "Inscrito" e achava que
// estava tudo certo. A arena só descobria na hora do sorteio, e a pessoa só
// descobria quando alguém cobrava pelo WhatsApp. O botão leva ao MESMO link
// pessoal (/p/<token>) que o admin manda na cobrança, então os dois caminhos
// caem na mesma tela de pagamento.
import Link from 'next/link'
import { CreditCard } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatWalletCents } from '@/lib/wallet/wallet'

interface Props {
  amountCents: number
  /** /p/<token>. Nulo só se o token falhou ao ser gerado. */
  paymentPath: string | null
  /** Comprovante já enviado: falta a arena conferir, não o aluno pagar. */
  receiptSent: boolean
}

export function MyEntryPaymentCard({ amountCents, paymentPath, receiptSent }: Props) {
  return (
    <div className="space-y-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3">
      <div className="flex flex-col gap-1.5 xs:flex-row xs:items-center xs:justify-between xs:gap-3">
        <Badge variant="warning" className="w-fit shrink-0">
          {receiptSent ? 'Pagamento em análise' : 'Pagamento pendente'}
        </Badge>
        <span className="text-sm font-bold text-white">{formatWalletCents(amountCents)}</span>
      </div>
      <p className="text-sm text-yellow-100/90">
        {receiptSent
          ? 'Recebemos seu comprovante. A arena confirma o pagamento e sua vaga fica garantida.'
          : 'Sua inscrição só fica garantida depois do pagamento.'}
      </p>
      {paymentPath && (
        <Link href={paymentPath} className="block">
          <Button size="lg" variant={receiptSent ? 'secondary' : 'primary'} className="w-full">
            <CreditCard className="h-4 w-4" aria-hidden />
            {receiptSent ? 'Ver pagamento' : 'Pagar inscrição'}
          </Button>
        </Link>
      )}
    </div>
  )
}
