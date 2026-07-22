// features/home/HeroHeader.tsx
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { GreetingLine } from './GreetingLine'

interface HeroStat {
  label: string
  value: string | number
}

/**
 * Cabeçalho da home do aluno: gradiente da academia, malha técnica por cima e
 * os números do aluno em pastilhas de vidro.
 */
export function HeroHeader({ name, stats }: { name: string; stats: HeroStat[] }) {
  return (
    <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-28px_rgb(var(--brand-600)/0.95)]">
      {/* Malha fina: dá textura de painel técnico ao gradiente. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      {/* Clarão diagonal no canto superior. */}
      <div
        aria-hidden
        className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl"
      />

      <div className="relative">
        <GreetingLine name={name} />

        <div className="mt-5 grid grid-cols-3 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm"
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/75">
                {stat.label}
              </p>
              <p className="mt-0.5 text-xl font-extrabold leading-none text-white">
                {typeof stat.value === 'number' ? (
                  <AnimatedNumber value={stat.value} />
                ) : (
                  <span className="text-base">{stat.value}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
