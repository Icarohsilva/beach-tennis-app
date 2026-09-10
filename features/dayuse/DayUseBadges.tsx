// features/dayuse/DayUseBadges.tsx
// A fileira de identificação de um day use — modalidade, tipo, espaço e preço.
// Um componente só porque o card do admin, o do aluno e (fase 4) a página
// pública mostram os MESMOS fatos: em cópias separadas, o "Gratuito" fixo que
// existia no card do aluno é exatamente o tipo de divergência que aparece.
import { DAY_USE_KIND_LABEL, formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import type { DayUseKind } from '@/types'

const CHIP = 'text-xs px-2 py-0.5 rounded-full border whitespace-nowrap'

export function DayUseBadges({
  court,
  sport,
  kind,
  priceCents,
  payOnSite = false,
}: {
  court: number
  sport: string | null
  kind: DayUseKind
  /** Já resolvido por dayUseChargeCents — 0 = gratuito de verdade. */
  priceCents: number
  /** Tem preço e o pagamento é na arena (dayUsePriceView.payOnSite). */
  payOnSite?: boolean
}) {
  return (
    <div className="flex items-center gap-2 mb-1 flex-wrap">
      <span className={`${CHIP} bg-blue-900/40 text-blue-300 border-blue-700/50`}>
        Espaço {court}
      </span>
      {sport && (
        <span className={`${CHIP} bg-surface text-slate-300 border-surface-border`}>
          {sportEmoji(sport)} {sportLabel(sport)}
        </span>
      )}
      <span className={`${CHIP} bg-surface text-slate-300 border-surface-border`}>
        {DAY_USE_KIND_LABEL[kind]}
      </span>
      <span
        className={
          priceCents > 0
            ? `${CHIP} bg-brand-900/40 text-brand-300 border-brand-700/50`
            : `${CHIP} bg-green-900/40 text-green-300 border-green-700/50`
        }
      >
        {formatDayUsePrice(priceCents)}
      </span>
      {payOnSite && (
        <span
          className={`${CHIP} bg-yellow-900/40 text-yellow-300 border-yellow-700/50`}
          title="O aluno paga na arena: a academia não recebe este valor pelo app."
        >
          Pagar na arena
        </span>
      )}
    </div>
  )
}
