'use client'
// components/ui/SportsPicker.tsx
import { useState } from 'react'
import { SPORTS, isCustomSport, sanitizeCustomSport, sportLabel } from '@/lib/arenas/sports'

interface SportsPickerProps {
  value: string[]
  onChange: (next: string[]) => void
}

const chipBase = 'text-sm rounded-full px-3 py-1.5 border transition-colors'
const chipOn = 'border-brand-500 bg-brand-500/15 text-white'
const chipOff = 'border-surface-border bg-surface-card text-slate-400 hover:border-slate-500'

export function SportsPicker({ value, onChange }: SportsPickerProps) {
  const [custom, setCustom] = useState('')

  function toggle(slug: string) {
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
  }

  function addCustom() {
    const clean = sanitizeCustomSport(custom)
    if (clean && !value.includes(clean)) onChange([...value, clean])
    setCustom('')
  }

  const customTags = value.filter(isCustomSport)

  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-300 font-medium">Modalidades oferecidas</label>
      <div className="flex flex-wrap gap-2">
        {SPORTS.map((sport) => (
          <button
            key={sport.slug}
            type="button"
            onClick={() => toggle(sport.slug)}
            className={[chipBase, value.includes(sport.slug) ? chipOn : chipOff].join(' ')}
          >
            {sport.emoji} {sport.label}
          </button>
        ))}
        {customTags.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => toggle(slug)}
            className={[chipBase, chipOn].join(' ')}
          >
            {sportLabel(slug)} ✕
          </button>
        ))}
      </div>
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
    </div>
  )
}
