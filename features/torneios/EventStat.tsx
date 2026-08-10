// features/torneios/EventStat.tsx
// Um número do evento/arena, para ficar dentro de um <dl>.
//
// Igual ao Stat do perfil do atleta, mas semanticamente dt/dd: aqui a lista é
// "rótulo → valor" de verdade, e o leitor de tela deve ler o par junto.
import { cn } from '@/lib/utils/cn'

interface EventStatProps {
  label: string
  value: string | number
  tone?: 'emerald' | 'brand'
}

export function EventStat({ label, value, tone }: EventStatProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-surface-card p-2.5 xs:p-3">
      {/* tracking menor e quebra permitida: em grade de 3 colunas a caixa tem ~56px
          em 320px, e "INSCRIÇÃO" com tracking-wider sozinho pede ~62px. */}
      <dt className="break-words text-[10px] font-bold uppercase tracking-wide text-slate-400 xs:tracking-wider">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-xl font-extrabold leading-none tabular-nums xs:text-2xl',
          tone === 'emerald' ? 'text-emerald-300' : tone === 'brand' ? 'text-brand-400' : 'text-white',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
