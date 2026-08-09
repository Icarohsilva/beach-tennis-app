'use client'
// features/torneios/TournamentFilters.tsx
// Controles da vitrine: busca, modalidade, estado e nível.
//
// O filtro mora na URL, não no estado do componente. Isso mantém a lista em
// Server Component (nada de baixar todos os torneios para filtrar no browser),
// deixa o resultado compartilhável por link e faz o botão "voltar" desfazer o
// filtro — que é o que o aluno espera no celular.
import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { Facet, Phase } from '@/lib/torneios/browse'
import { sportChip } from '@/lib/torneios/sportProfile'
import { toneClasses } from './sportTone'

type PhaseKey = Phase | 'todos' | 'meus'

interface PhaseOption {
  key: PhaseKey
  label: string
  count: number
}

interface TournamentFiltersProps {
  sports: Facet[]
  levels: Facet[]
  phases: PhaseOption[]
  active: { q: string; sport: string; level: string; phase: string }
}

/** Espera o aluno parar de digitar antes de ir ao servidor. */
const SEARCH_DEBOUNCE_MS = 320

export function TournamentFilters({ sports, levels, phases, active }: TournamentFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [term, setTerm] = useState(active.q)
  const [showMore, setShowMore] = useState(!!active.level)
  // Só a digitação do aluno dispara navegação; sincronizar do lado do servidor
  // aqui reenviaria a mesma busca em loop.
  const typedRef = useRef(false)

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  // Debounce da busca.
  useEffect(() => {
    if (!typedRef.current) return
    const id = setTimeout(() => pushParams({ busca: term.trim() }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  // A navegação externa (voltar do browser, link compartilhado) reescreve o campo.
  useEffect(() => {
    typedRef.current = false
    setTerm(active.q)
  }, [active.q])

  const hasFilter = !!(active.q || active.sport || active.level || (active.phase && active.phase !== 'todos'))

  function clearAll() {
    typedRef.current = false
    setTerm('')
    pushParams({ busca: '', esporte: '', nivel: '', quando: '' })
  }

  return (
    <div className={cn('space-y-3 transition-opacity', isPending && 'opacity-60')}>
      {/* ── Busca ───────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        />
        <input
          type="search"
          inputMode="search"
          value={term}
          onChange={(e) => {
            typedRef.current = true
            setTerm(e.target.value)
          }}
          placeholder="Buscar torneio ou modalidade"
          aria-label="Buscar torneio"
          className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 focus:border-brand-600/60 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              typedRef.current = true
              setTerm('')
            }}
            aria-label="Limpar busca"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Modalidade ──────────────────────────────────────────────────────
          Só aparece quando há mais de uma: numa academia só de beach tennis a
          aba seria uma fileira de um botão sempre ligado. */}
      {sports.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2">
            <SportChip
              label="Todos"
              emoji="🏟️"
              active={!active.sport}
              onClick={() => pushParams({ esporte: '', nivel: '' })}
            />
            {sports.map((s) => {
              const chip = sportChip(s.value)
              return (
                <SportChip
                  key={s.value}
                  label={chip.label}
                  emoji={chip.emoji}
                  count={s.count}
                  toneClass={toneClasses(chip.tone).pill}
                  active={active.sport === s.value}
                  // Trocar de esporte zera o nível: "Nível B" de beach tennis e
                  // "Avançado" de crossfit são a mesma letra com outro sentido.
                  onClick={() => pushParams({ esporte: s.value, nivel: '' })}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Estado + atalhos ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {phases.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pushParams({ quando: p.key === 'todos' ? '' : p.key })}
            aria-pressed={active.phase === p.key || (!active.phase && p.key === 'todos')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              active.phase === p.key || (!active.phase && p.key === 'todos')
                ? 'bg-brand-600 text-white'
                : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-brand-600/50 hover:text-white',
            )}
          >
            {p.key === 'live' && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
              </span>
            )}
            {p.label}
            <span className="text-[10px] opacity-70">{p.count}</span>
          </button>
        ))}

        {levels.length > 1 && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              active.level
                ? 'bg-brand-600 text-white'
                : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-brand-600/50 hover:text-white',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {active.level ? levels.find((l) => l.value === active.level)?.label ?? 'Nível' : 'Nível'}
          </button>
        )}

        {hasFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>

      {showMore && levels.length > 1 && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
          <LevelChip label="Todos os níveis" active={!active.level} onClick={() => pushParams({ nivel: '' })} />
          {levels.map((l) => (
            <LevelChip
              key={l.value}
              label={l.label}
              count={l.count}
              active={active.level === l.value}
              onClick={() => pushParams({ nivel: l.value })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SportChip({
  label,
  emoji,
  count,
  toneClass,
  active,
  onClick,
}: {
  label: string
  emoji: string
  count?: number
  toneClass?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all',
        active
          ? cn('scale-[1.02]', toneClass ?? 'border-brand-500/40 bg-brand-500/15 text-brand-200')
          : 'border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-white',
      )}
    >
      <span aria-hidden>{emoji}</span>
      {label}
      {typeof count === 'number' && <span className="text-[10px] opacity-70">{count}</span>}
    </button>
  )
}

function LevelChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'bg-brand-600 text-white'
          : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-brand-600/50 hover:text-white',
      )}
    >
      {label}
      {typeof count === 'number' && <span className="text-[10px] opacity-70">{count}</span>}
    </button>
  )
}
