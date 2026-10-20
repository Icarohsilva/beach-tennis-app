'use client'
// app/(admin)/admin/torneios/[id]/ImportEntrantsCard.tsx
// "Trazer inscritos de outros torneios": escolhe o torneio de origem (aberto ou
// encerrado), filtra pelo nome, marca quem vem e inclui de uma vez. A lista só
// é carregada ao abrir, porque reúne os inscritos de todos os torneios da arena.
// Regras em features/torneios/importEntrantsActions.ts.
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  addEntrantsFromOtherTournaments,
  listImportCandidates,
  type ImportCandidate,
  type ImportResult,
  type ImportSourceTournament,
} from '@/features/torneios/importEntrantsActions'

const STATUS_LABEL: Record<string, string> = {
  draft: 'rascunho',
  open: 'inscrições abertas',
  in_progress: 'em andamento',
  finished: 'encerrado',
}

const fieldClass =
  'w-full min-w-0 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none'

export function ImportEntrantsCard({ tournamentId }: { tournamentId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tournaments, setTournaments] = useState<ImportSourceTournament[]>([])
  const [people, setPeople] = useState<ImportCandidate[]>([])
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, startLoading] = useTransition()
  const [saving, startSaving] = useTransition()

  function load() {
    setOpen(true)
    setError(null)
    startLoading(async () => {
      const res = await listImportCandidates(tournamentId)
      if (res.error) { setError(res.error); return }
      setTournaments(res.tournaments ?? [])
      setPeople(res.people ?? [])
    })
  }

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '')
    return people.filter((p) => {
      if (source && !p.tournamentIds.includes(source)) return false
      if (!q) return true
      return p.name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)
    })
  }, [people, source, query])

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach((p) => next.delete(p.id))
      else visible.forEach((p) => next.add(p.id))
      return next
    })
  }

  function submit() {
    setError(null)
    setResult(null)
    startSaving(async () => {
      const res = await addEntrantsFromOtherTournaments(tournamentId, Array.from(selected))
      if (res.error) { setError(res.error); return }
      setResult(res)
      const added = new Set(Array.from(selected))
      const skippedNames = new Set((res.skipped ?? []).map((s) => s.name))
      // Quem entrou sai da lista; quem foi recusado fica marcado para o admin ver.
      setPeople((prev) => prev.filter((p) => !added.has(p.id) || skippedNames.has(p.name)))
      setSelected(new Set())
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Card>
        <p className="text-sm font-semibold text-white">Trazer inscritos de outros torneios</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Inclua aqui quem já jogou outro campeonato da arena, aberto ou encerrado, sem digitar o cadastro de novo.
        </p>
        <Button type="button" variant="secondary" size="sm" className="mt-3 gap-1.5" onClick={load}>
          <Users className="h-3.5 w-3.5" aria-hidden />
          Escolher inscritos
        </Button>
      </Card>
    )
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Trazer inscritos de outros torneios</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Cada pessoa entra com a regra deste torneio: vaga, categoria e valor da inscrição.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando inscritos…</p>
      ) : (
        <>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Torneio de origem" className={fieldClass}>
            <option value="">Todos os torneios</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({STATUS_LABEL[t.status] ?? t.status})
              </option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pelo nome"
            aria-label="Buscar pelo nome"
            className={fieldClass}
          />

          {visible.length === 0 ? (
            <p className="text-sm text-slate-400">
              {people.length === 0 ? 'Ninguém de outros torneios para incluir.' : 'Ninguém encontrado com esse filtro.'}
            </p>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-300">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4 accent-brand-500" />
                Selecionar todos da lista ({visible.length})
              </label>
              <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-surface-border bg-surface p-1">
                {visible.map((p) => (
                  <li key={p.id}>
                    <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-card">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 shrink-0 accent-brand-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{p.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={submit} disabled={selected.size === 0 || saving}>
              {saving ? 'Incluindo…' : `Incluir ${selected.size || ''} selecionado${selected.size === 1 ? '' : 's'}`.replace('  ', ' ')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => { setOpen(false); setResult(null); setError(null) }}>
              Fechar
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && (
        <div className="space-y-1 text-sm">
          <p className="text-green-400">
            {result.confirmed ?? 0} incluído(s)
            {result.waitlisted ? `, ${result.waitlisted} na lista de espera` : ''}.
          </p>
          {(result.skipped ?? []).length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-300">
              {result.skipped!.map((s, i) => (
                <li key={i}>{s.name}: {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
