'use client'
// app/(admin)/torneios/CreateTournamentForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { createTournament } from '@/features/torneios/actions'
import { SPORTS } from '@/lib/arenas/sports'
import { pairGendersFor, pairGendersLabel } from '@/lib/torneios/pairRules'
import type {
  TournamentCategory,
  ParticipantType,
  TournamentFormat,
} from '@/types'
import { createClient } from '@/lib/supabase/client'

const CATEGORY_OPTIONS: { value: TournamentCategory; label: string }[] = [
  { value: 'livre', label: 'Livre' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'misto', label: 'Misto' },
]
const PARTICIPANT_OPTIONS: { value: ParticipantType; label: string }[] = [
  { value: 'dupla_revezando', label: 'Dupla Revezando (Super)' },
  { value: 'dupla_fixa', label: 'Dupla Fixa' },
  { value: 'individual', label: 'Individual' },
]
// A lista espelha as chaves de lib/torneios/formats.ts: oferecer aqui um
// formato que o motor não sabe gerar dá "formato não suportado" só na hora de
// gerar a chave, com o torneio já divulgado e as inscrições abertas.
const FORMAT_OPTIONS: { value: TournamentFormat; label: string; hint: string }[] = [
  {
    value: 'americano',
    label: 'Super',
    hint: 'Todos jogam com todos, trocando de parceiro a cada rodada. Classifica por saldo de games.',
  },
  {
    value: 'round_robin',
    label: 'Todos contra todos',
    hint: 'A mesma dupla o torneio inteiro, enfrentando cada adversário uma vez.',
  },
  {
    value: 'eliminatoria',
    label: 'Eliminatória (mata-mata)',
    hint: 'Quem perde está fora. A chave sai completa, com cabeças-de-chave e bye.',
  },
  {
    value: 'grupos',
    label: 'Grupos + mata-mata',
    hint: 'Primeira fase em grupos, e os melhores decidem no mata-mata. Todo mundo joga várias vezes antes de arriscar a eliminação.',
  },
]

const selectClass =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

/** O que a categoria escolhida vai travar na inscrição — dá para mudar depois em "Configurar". */
function entryRuleHint(category: TournamentCategory): string {
  const allowed = pairGendersFor(category)
  if (category === 'livre') return 'Livre: qualquer gênero entra, sem restrição de dupla.'
  return `Trava a inscrição: ${pairGendersLabel(allowed).toLowerCase()}.`
}

export function CreateTournamentForm() {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [sport, setSport] = useState(SPORTS[0].slug)
  const [category, setCategory] = useState<TournamentCategory>('livre')
  const [participantType, setParticipantType] = useState<ParticipantType>('dupla_revezando')
  const [format, setFormat] = useState<TournamentFormat>('americano')
  const [gamesPerSet, setGamesPerSet] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [entryPrice, setEntryPrice] = useState<string>('')
  const [pixKey, setPixKey] = useState<string>('')
  const [maxPlayers, setMaxPlayers] = useState<string>('')
  const [groupCount, setGroupCount] = useState(2)
  const [advancePerGroup, setAdvancePerGroup] = useState(2)
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

      const parsedPrice = parseFloat(entryPrice.replace(',', '.'))
      const entryPriceCents = entryPrice.trim() && !isNaN(parsedPrice) && parsedPrice >= 0
        ? Math.round(parsedPrice * 100)
        : null

      const parsedMax = parseInt(maxPlayers, 10)
      if (maxPlayers.trim() && (isNaN(parsedMax) || parsedMax < 2)) {
        setError('Limite de vagas deve ser um número inteiro de no mínimo 2.')
        return
      }
      const maxPlayersValue: number | null =
        maxPlayers.trim() && !isNaN(parsedMax) && parsedMax >= 2
          ? parsedMax
          : null

      const result = await createTournament({
        name: name.trim(),
        date,
        sport,
        category,
        participant_type: participantType,
        format,
        level: 'iniciante',
        scoring: { sets_to_win: 1, games_per_set: gamesPerSet, tiebreak_games: true },
        cover_image_url: coverImageUrl,
        entry_price_cents: entryPriceCents,
        pix_key: pixKey.trim() || null,
        max_players: maxPlayersValue,
        group_count: groupCount,
        advance_per_group: advancePerGroup,
      })
      if (result.error) setError(result.error)
      else {
        setName('')
        setDate('')
        setCoverFile(null)
        setCoverPreview(null)
        setEntryPrice('')
        setPixKey('')
        setMaxPlayers('')
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
      <Input label="Nome do torneio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Super 8 de Sábado" required />
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
        {/* A categoria já nasce travando quem entra (createTournament deriva
            allowed_pair_genders dela) — sem isto o admin não teria como saber,
            antes de criar, que "Masculino" já impede mulher de se inscrever. */}
        <p className="text-xs text-slate-500">{entryRuleHint(category)}</p>
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
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400">
          {FORMAT_OPTIONS.find((f) => f.value === format)?.hint}
        </p>
      </div>

      {/* Configuração que só existe no formato de grupos — some nos outros para
          não sugerir um grupo que o torneio não tem. */}
      {format === 'grupos' && (
        <div className="grid gap-3 rounded-lg border border-surface-border bg-surface-card/60 p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Grupos</label>
            <select
              value={groupCount}
              onChange={(e) => setGroupCount(Number(e.target.value))}
              className={selectClass}
            >
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>{n} grupos</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Passam por grupo</label>
            <select
              value={advancePerGroup}
              onChange={(e) => setAdvancePerGroup(Number(e.target.value))}
              className={selectClass}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n === 1 ? 'Só o líder' : `Os ${n} primeiros`}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-400 sm:col-span-2">
            Precisa de ao menos {groupCount * 2} inscritos. O mata-mata com{' '}
            {groupCount * advancePerGroup} classificados sai sozinho quando o último jogo
            da fase de grupos for confirmado.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Games por set</label>
        <select value={gamesPerSet} onChange={(e) => setGamesPerSet(Number(e.target.value))} className={selectClass}>
          {[4, 6, 8, 9].map((g) => (<option key={g} value={g}>{g} games</option>))}
        </select>
      </div>

      {/* Inscrição paga (opcional) */}
      <Input
        label="Valor da inscrição (R$)"
        type="number"
        min="0"
        step="0.01"
        placeholder="0 = gratuito"
        value={entryPrice}
        onChange={(e) => setEntryPrice(e.target.value)}
      />

      <div className="flex flex-col gap-1">
        <Input
          label="Chave PIX"
          type="text"
          placeholder="Deixe vazio para torneio gratuito"
          value={pixKey}
          onChange={(e) => setPixKey(e.target.value)}
        />
        <p className="text-xs text-slate-500">CPF, email, telefone ou chave aleatória. Ambos os campos precisam ser preenchidos para cobrança.</p>
      </div>

      <Input
        label="Limite de vagas"
        type="number"
        min="2"
        step="1"
        placeholder="Sem limite (deixe vazio)"
        value={maxPlayers}
        onChange={(e) => setMaxPlayers(e.target.value)}
      />

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
