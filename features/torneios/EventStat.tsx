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
    <div className="rounded-2xl border border-white/[0.07] bg-surface-card p-3">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-extrabold leading-none tabular-nums',
          tone === 'emerald' ? 'text-emerald-300' : tone === 'brand' ? 'text-brand-400' : 'text-white',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
