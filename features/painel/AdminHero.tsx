// features/painel/AdminHero.tsx
import Link from 'next/link'
import { GreetingLine } from '@/features/home/GreetingLine'

interface AdminHeroProps {
  orgName: string
  /** Resumo curto do dia: "4 aulas · 22 alunos esperados". */
  pulse: string
  actions?: { href: string; label: string }[]
}

/**
 * Faixa de abertura do painel: quem é a academia, como está o dia e os dois
 * atalhos que o professor mais usa antes da primeira aula.
 */
export function AdminHero({ orgName, pulse, actions = [] }: AdminHeroProps) {
  return (
    <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-30px_rgb(var(--brand-600)/0.95)] sm:p-6">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
      />
      <div
        aria-hidden
        className="absolute -right-20 -top-24 h-60 w-60 rounded-full bg-white/20 blur-3xl"
      />

      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <GreetingLine name={orgName} />
          <p className="mt-2 text-sm font-medium text-white/85">{pulse}</p>
        </div>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="rounded-xl border border-white/25 bg-white/15 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/25 active:scale-[0.98]"
              >
                {action.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
