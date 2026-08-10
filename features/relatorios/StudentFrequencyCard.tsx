// features/relatorios/StudentFrequencyCard.tsx
import { ProgressRing } from '@/components/ui/ProgressRing'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import type { StudentTotals } from '@/lib/utils/attendanceReport'

/**
 * Frequência do próprio aluno. Presença presumida não é rotulada como tal para
 * ele — a distinção existe para o professor decidir se corrige.
 */
export function StudentFrequencyCard({
  totals,
  periodLabel,
}: {
  totals: StudentTotals | null
  periodLabel: string
}) {
  if (!totals || totals.expected === 0) {
    return (
      <div className="glass rounded-2xl border border-white/[0.07] p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Sua frequência · {periodLabel}
        </p>
        <p className="mt-2 text-sm text-slate-400">Nenhuma aula registrada neste período ainda.</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-2xl border border-white/[0.07] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Sua frequência · {periodLabel}
      </p>
      {/* O anel tem largura fixa (64px via style), então em 320px sobravam ~53px por
          célula — menos que o rótulo "Presenças" (~62px). Abaixo de 400px o anel vai
          para a própria linha e os três números ficam com a largura inteira (~85px
          cada). Nada de conteúdo se perde: o anel continua mostrando a taxa. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 xs:gap-4">
        <div className="shrink-0">
          <ProgressRing percent={totals.rate} size={64} strokeWidth={6}>
            <span className="text-sm font-extrabold text-white">
              <AnimatedNumber value={totals.rate} suffix="%" />
            </span>
          </ProgressRing>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 text-center xs:w-auto xs:min-w-0 xs:flex-1">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Presenças</dt>
            <dd className="text-lg font-extrabold text-emerald-300">
              <AnimatedNumber value={totals.present} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Faltas</dt>
            <dd className="text-lg font-extrabold text-white">
              <AnimatedNumber value={totals.absent} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Avisou</dt>
            <dd className="text-lg font-extrabold text-slate-300">
              <AnimatedNumber value={totals.notified} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
