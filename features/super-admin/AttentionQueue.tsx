// features/super-admin/AttentionQueue.tsx
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { AttentionItem, AttentionSeverity } from '@/lib/superAdmin/metrics'

const SEVERITY: Record<
  AttentionSeverity,
  { icon: typeof AlertTriangle; ring: string; text: string; label: string }
> = {
  alta: { icon: AlertTriangle, ring: 'ring-red-500/30 bg-red-500/[0.07]', text: 'text-red-300', label: 'Alta' },
  media: { icon: AlertTriangle, ring: 'ring-amber-500/30 bg-amber-500/[0.07]', text: 'text-amber-300', label: 'Média' },
  baixa: { icon: Info, ring: 'ring-sky-500/25 bg-sky-500/[0.05]', text: 'text-sky-300', label: 'Baixa' },
}

/**
 * O que exige ação humana hoje, em ordem de urgência. É a primeira coisa da
 * visão geral: a pergunta do dia não é "quanto faturamos" e sim "o que está
 * pegando fogo".
 */
export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="glass flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-white">Nada pendente</p>
          <p className="text-xs text-slate-400">
            Sem atrasos de pagamento, trials no limite ou filas abertas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const s = SEVERITY[item.severity]
        const Icon = s.icon
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-inset transition-all hover:-translate-y-0.5',
                s.ring,
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', s.text)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                {item.detail && (
                  <p className="truncate text-xs text-slate-400">{item.detail}</p>
                )}
              </div>
              <span className={cn('hidden shrink-0 text-[10px] font-bold uppercase sm:block', s.text)}>
                {s.label}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-white" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
