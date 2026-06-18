// app/arenas/ArenaFilters.tsx
// Form GET puro (sem JS): submete cidade/esporte como query string e recarrega
// o diretório no servidor.

import { SPORTS } from '@/lib/arenas/sports'

interface ArenaFiltersProps {
  cities: string[]
  selectedCity?: string
  selectedSport?: string
}

export function ArenaFilters({ cities, selectedCity, selectedSport }: ArenaFiltersProps) {
  const selectClass =
    'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <form method="get" className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 mb-6">
      <select name="cidade" defaultValue={selectedCity ?? ''} className={selectClass}>
        <option value="">Todas as cidades</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select name="esporte" defaultValue={selectedSport ?? ''} className={selectClass}>
        <option value="">Todos os esportes</option>
        {SPORTS.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.emoji} {s.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="rounded-lg bg-brand-500 text-surface font-semibold px-5 py-2 hover:bg-brand-400 transition-colors"
      >
        Filtrar
      </button>
    </form>
  )
}
