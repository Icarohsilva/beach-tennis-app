'use client'
// app/(admin)/torneios/CreateTournamentForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { createTournament } from '@/features/torneios/actions'
import { SPORTS } from '@/lib/arenas/sports'
import type {
  StudentLevel,
  TournamentCategory,
  ParticipantType,
  TournamentFormat,
} from '@/types'
import { createClient } from '@/lib/supabase/client'

const LEVEL_OPTIONS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const CATEGORY_OPTIONS: { value: TournamentCategory; label: string }[] = [
  { value: 'livre', label: 'Livre' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'misto', label: 'Misto' },
]
const PARTICIPANT_OPTIONS: { value: ParticipantType; label: string }[] = [
  { value: 'dupla_revezando', label: 'Dupla Revezando (Americano)' },
  { value: 'dupla_fixa', label: 'Dupla Fixa' },
  { value: 'individual', label: 'Individual' },
]
const FORMAT_OPTIONS: { value: TournamentFormat; label: string; enabled: boolean }[] = [
  { value: 'americano', label: 'Americano (Super N)', enabled: true },
  { value: 'round_robin', label: 'Round-robin (em breve)', enabled: false },
  { value: 'eliminatoria', label: 'Eliminatória (em breve)', enabled: false },
]

const selectClass =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

export function CreateTournamentForm() {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [sport, setSport] = useState(SPORTS[0].slug)
  const [category, setCategory] = useState<TournamentCategory>('livre')
  const [participantType, setParticipantType] = useState<ParticipantType>('dupla_revezando')
  const [format, setFormat] = useState<TournamentFormat>('americano')
  const [level, setLevel] = useState<StudentLevel>('C')
  const [gamesPerSet, setGamesPerSet] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !date) {
      setError('Preencha nome e data.')
      return
    }
    setError(null)
    startTransition(async () => {
      let coverImageUrl: string | null = null

      // Upload de imagem de capa (se selecionada)
      if (coverFile) {
        const supabase = createClient()
        const ext = coverFile.name.split('.').pop() ?? 'jpg'
        const path = `${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('tournament-images')
          .upload(path, coverFile)
        if (upErr) {
          setError('Erro ao fazer upload da imagem de capa.')
          return
        }
        const { data: urlData } = supabase.storage
          .from('tournament-images')
          .getPublicUrl(path)
        coverImageUrl = urlData.publicUrl
      }

      const result = await createTournament({
        name: name.trim(),
        date,
        sport,
        category,
        participant_type: participantType,
        format,
        level,
        scoring: { sets_to_win: 1, games_per_set: gamesPerSet, tiebreak_games: true },
        cover_image_url: coverImageUrl,
      })
      if (result.error) setError(result.error)
      else {
        setName('')
        setDate('')
        setCoverFile(null)
        setCoverPreview(null)
        router.refresh()
      }
    })
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <Input label="Nome do torneio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Americano Nível C Junho" required />
      <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Esporte</label>
        <select value={sport} onChange={(e) => setSport(e.target.value)} className={selectClass}>
          {SPORTS.map((s) => (
            <option key={s.slug} value={s.slug}>{s.emoji} {s.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Categoria</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as TournamentCategory)} className={selectClass}>
          {CATEGORY_OPTIONS.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Participação</label>
        <select value={participantType} onChange={(e) => setParticipantType(e.target.value as ParticipantType)} className={selectClass}>
          {PARTICIPANT_OPTIONS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Formato</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)} className={selectClass}>
          {FORMAT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value} disabled={!f.enabled}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Nível</label>
        <select value={level} onChange={(e) => setLevel(e.target.value as StudentLevel)} className={selectClass}>
          {LEVEL_OPTIONS.map((l) => (
            <option key={l} value={l}>{l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Games por set</label>
        <select value={gamesPerSet} onChange={(e) => setGamesPerSet(Number(e.target.value))} className={selectClass}>
          {[4, 6, 8, 9].map((g) => (<option key={g} value={g}>{g} games</option>))}
        </select>
      </div>

      {/* Campo de imagem de capa */}
      <div className="sm:col-span-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-300">Imagem de capa <span className="text-slate-500 font-normal">(opcional)</span></span>
          <div
            className="border-2 border-dashed border-surface-border rounded-xl p-4 text-center cursor-pointer hover:border-brand-500/50 transition-colors"
            style={{ background: '#1a1f2e' }}
          >
            {coverPreview ? (
              <img src={coverPreview} alt="Preview" className="w-full h-24 object-cover rounded-lg" />
            ) : (
              <>
                <div className="text-2xl mb-1">🖼️</div>
                <p className="text-brand-500 text-xs font-semibold">Escolher arquivo</p>
                <p className="text-slate-500 text-xs mt-1">Aparece no link compartilhado (JPEG / PNG / WebP, max 5 MB)</p>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverChange}
            />
          </div>
        </label>
      </div>

      {error && <p className="text-xs text-red-400 sm:col-span-2">{error}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>Criar Torneio</Button>
      </div>
    </form>
  )
}
