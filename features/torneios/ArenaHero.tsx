// features/torneios/ArenaHero.tsx
// Cabeçalho da aba Arena.
//
// O anterior era só um título sobre um degradê. Este responde, antes de qualquer
// rolagem, as quatro perguntas com que o aluno abre a aba: tem algo rolando
// agora? dá pra entrar em quê? sobrou vaga? eu estou em algum?
import { cn } from '@/lib/utils/cn'
import type { BrowseSummary } from '@/lib/torneios/browse'

interface ArenaHeroProps {
  summary: BrowseSummary
  /** Quantas modalidades a academia oferece — muda a frase de apoio. */
  sportsLabel: string | null
}

export function ArenaHero({ summary, sportsLabel }: ArenaHeroProps) {
  const stats = [
    summary.live > 0 ? { key: 'live', value: summary.live, label: 'ao vivo', live: true } : null,
    { key: 'open', value: summary.open, label: 'com inscrição' },
    summary.openSpots > 0 ? { key: 'spots', value: summary.openSpots, label: 'vagas livres' } : null,
    summary.mine > 0 ? { key: 'mine', value: summary.mine, label: 'que você disputa' } : null,
  ].filter((s): s is { key: string; value: number; label: string; live?: boolean } => s !== null)

  return (
    <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-30px_rgb(var(--brand-600)/0.95)]">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
      />
      <div aria-hidden className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />

      <div className="relative">
        <h1 className="text-2xl font-extrabold text-white">Arena</h1>
        <p className="mt-1 text-sm font-medium text-white/85">
          {sportsLabel
            ? `Torneios de ${sportsLabel} e quadra avulsa.`
            : 'Torneios da sua academia e quadra avulsa (Day Use).'}
        </p>

        {stats.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-2">
            {stats.map((s) => (
              <div
                key={s.key}
                className={cn(
                  'flex items-baseline gap-1.5 rounded-xl border px-2.5 py-1.5 backdrop-blur-sm',
                  s.live ? 'border-white/30 bg-white/20' : 'border-white/15 bg-white/10',
                )}
              >
                {s.live && (
                  <span className="relative mr-0.5 flex h-1.5 w-1.5 self-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                )}
                <dd className="text-base font-extrabold leading-none text-white">{s.value}</dd>
                <dt className="text-[11px] font-semibold text-white/80">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
