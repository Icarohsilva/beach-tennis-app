// features/liga/PrizeBanner.tsx
import { Gift, PartyPopper } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { sportLabel } from '@/lib/arenas/sports'
import type { LigaPrize, LigaPrizeAward } from '@/types'

interface Props {
  prizes: LigaPrize[]
  /** Prêmios que ESTE aluno já ganhou e ainda não recebeu. */
  myAwards: LigaPrizeAward[]
}

function prizeLabel(kind: string, position: number | null): string {
  if (kind === 'promoted') return 'Quem subir de divisão'
  return `${position}º lugar`
}

/**
 * O que está valendo na temporada, e o que o aluno já ganhou.
 *
 * Vem antes do ranking na tela porque é o que dá sentido a ele: sem saber o que está
 * em jogo, a tabela é só uma lista de nomes.
 */
export function PrizeBanner({ prizes, myAwards }: Props) {
  if (prizes.length === 0 && myAwards.length === 0) return null

  return (
    <div className="space-y-3">
      {myAwards.length > 0 && (
        <Card className="border-emerald-500/40 bg-emerald-500/[0.07]">
          <div className="mb-2 flex items-center gap-2">
            <PartyPopper className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-bold text-white">
              {myAwards.length === 1 ? 'Você ganhou um prêmio' : 'Você ganhou prêmios'}
            </p>
          </div>
          <ul className="space-y-1">
            {myAwards.map((award) => (
              <li key={award.id} className="text-sm text-slate-200">
                <span className="text-emerald-400">
                  {prizeLabel(award.kind, award.position)}
                </span>{' '}
                em {sportLabel(award.sport)}: {award.description}
                {award.credit_classes > 0 && (
                  <span className="text-slate-400">
                    {' '}
                    ({award.credit_classes}{' '}
                    {award.credit_classes === 1 ? 'aula creditada' : 'aulas creditadas'})
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Fale com a academia para receber.</p>
        </Card>
      )}

      {prizes.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Gift className="h-4 w-4 text-brand-500" />
            <p className="text-xs tracking-wide text-slate-400">O QUE ESTÁ VALENDO</p>
          </div>
          <ul className="space-y-1.5">
            {prizes.map((prize) => (
              <li key={prize.id} className="flex items-start gap-2 text-sm">
                <span className="w-28 shrink-0 text-xs font-semibold text-brand-500">
                  {prizeLabel(prize.kind, prize.position)}
                </span>
                <span className="min-w-0 flex-1 text-slate-200">
                  {prize.description}
                  {prize.credit_classes > 0 && (
                    <span className="text-slate-400">
                      {' '}
                      + {prize.credit_classes} {prize.credit_classes === 1 ? 'aula' : 'aulas'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
