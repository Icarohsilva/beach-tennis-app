'use client'
// components/ui/SportsPicker.tsx
// Multi-seleção de modalidades. Dois usos com domínios diferentes:
//  - academia (onboarding/vitrine): cardápio completo + texto livre "Outro";
//  - aluno (cadastro/perfil/admin): só o cardápio da academia, sem texto livre.
import { useState } from 'react'
import { SPORTS, SPORT_BY_SLUG, isCustomSport, sanitizeCustomSport, sportLabel } from '@/lib/arenas/sports'

interface SportsPickerProps {
  value: string[]
  onChange: (next: string[]) => void
  /** Slugs oferecidos. Default: todas as modalidades conhecidas. */
  options?: string[]
  label?: string
  /** Campo "Outro" (texto livre). Default: true. */
  allowCustom?: boolean
}

const chipBase = 'text-sm rounded-full px-3 py-1.5 border transition-colors'
const chipOn = 'border-brand-500 bg-brand-500/15 text-white'
const chipOff = 'border-surface-border bg-surface-card text-slate-400 hover:border-slate-500'

export function SportsPicker({
  value,
  onChange,
  options,
  label = 'Modalidades oferecidas',
  allowCustom = true,
}: SportsPickerProps) {
  const [custom, setCustom] = useState('')

  const slugs = options ?? SPORTS.map((s) => s.slug)

  function toggle(slug: string) {
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
  }

  function addCustom() {
    const clean = sanitizeCustomSport(custom)
    if (clean && !value.includes(clean)) onChange([...value, clean])
    setCustom('')
  }

  // Com texto livre, as tags custom já selecionadas viram chips removíveis à parte.
  // Sem texto livre elas já estão em `slugs` (vindas do cardápio da academia).
  const customTags = allowCustom ? value.filter(isCustomSport) : []

  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-300 font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        {slugs.map((slug) => {
          const sport = SPORT_BY_SLUG.get(slug)
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
              aria-pressed={value.includes(slug)}
              className={[chipBase, value.includes(slug) ? chipOn : chipOff].join(' ')}
            >
              {sport ? `${sport.emoji} ${sport.label}` : sportLabel(slug)}
            </button>
          )
        })}
        {customTags.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => toggle(slug)}
            aria-pressed={true}
            aria-label={`Remover ${sportLabel(slug)}`}
            className={[chipBase, chipOn].join(' ')}
          >
            {sportLabel(slug)} ✕
          </button>
        ))}
      </div>
      {allowCustom && (
        <div className="flex gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="Outro (ex.: Jiu Jitsu)"
            className="flex-1 bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={addCustom}
            className="text-sm rounded-lg px-3 py-1.5 border border-surface-border bg-surface-card text-slate-200 hover:border-brand-500"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  )
}
