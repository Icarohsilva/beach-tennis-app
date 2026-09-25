'use client'
// app/(admin)/admin/torneios/EventsPanel.tsx
// Painel das páginas de evento: cria, publica e mostra o link a divulgar.
//
// O evento é a capa que agrupa vários torneios ("Copa de Agosto" com misto,
// masculino B, feminino A). A academia divulga UM link e a pessoa escolhe a
// categoria dela lá dentro, em vez de a academia postar seis links no Instagram.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Copy, ExternalLink, Plus, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button, buttonClasses } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createTournamentEvent, setEventPublished } from '@/features/torneios/eventActions'
import {
  updateTournamentEventContent,
  updateTournamentEventCover,
} from '@/features/torneios/configActions'
import { createClient } from '@/lib/supabase/client'
import { formatEventRange } from '@/lib/torneios/event'

export interface AdminEvent {
  id: string
  name: string
  slug: string
  starts_on: string
  ends_on: string | null
  is_published: boolean
  description: string | null
  rules: string | null
  venue: string | null
  cover_image_url: string | null
  tournamentCount: number
}

const inputClass =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500'

export function EventsPanel({ events }: { events: AdminEvent[] }) {
  const [open, setOpen] = useState(false)

  return (
    // Fechado ao abrir a página: a lista de torneios, que é o que o admin veio
    // ver, fica logo embaixo em vez de depois de dois cards inteiros.
    <CollapsibleCard
      title="Páginas de evento"
      subtitle="Um link só para divulgar; os torneios ficam dentro dele."
      meta={`${events.length} ${events.length === 1 ? 'evento' : 'eventos'}`}
    >
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          {open ? 'Fechar' : 'Novo evento'}
        </Button>
      </div>

      {open && <CreateEventForm onDone={() => setOpen(false)} />}

      {events.length === 0 ? (
        !open && (
          <p className="py-4 text-sm text-slate-400">
            Nenhuma página de evento ainda. Crie uma para agrupar os torneios de uma mesma data.
          </p>
        )
      ) : (
        <ul className="mt-4 space-y-2">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}

function CreateEventForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
  const [venue, setVenue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createTournamentEvent({
        name,
        starts_on: startsOn,
        ends_on: endsOn || null,
        description: description || null,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.id && (rules.trim() || venue.trim())) {
        await updateTournamentEventContent(result.id, { rules: rules || null, venue: venue || null })
      }
      setName('')
      setStartsOn('')
      setEndsOn('')
      setDescription('')
      setRules('')
      setVenue('')
      onDone()
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-xl border border-surface-border bg-surface/60 p-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          label="Nome do evento"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Copa de Agosto"
          required
        />
      </div>
      <Input label="Começa em" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
      <Input
        label="Termina em (opcional)"
        type="date"
        value={endsOn}
        onChange={(e) => setEndsOn(e.target.value)}
        min={startsOn || undefined}
      />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="text-sm font-medium text-slate-300">Descrição (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Resumo curto do evento…"
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="text-sm font-medium text-slate-300">Regulamento (opcional)</label>
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
          placeholder="Herdado por todos os torneios deste evento, salvo quando um deles tiver o próprio."
          className={inputClass}
        />
      </div>
      <div className="sm:col-span-2">
        <Input label="Local (opcional)" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Ex: Arena Central — Rua X, 123" />
      </div>
      {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending} size="sm">
          Criar evento
        </Button>
        <p className="mt-2 text-xs text-slate-500">
          Nasce como rascunho. Vincule os torneios e depois publique.
        </p>
      </div>
    </form>
  )
}

function EventRow({ event }: { event: AdminEvent }) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [description, setDescription] = useState(event.description ?? '')
  const [rules, setRules] = useState(event.rules ?? '')
  const [venue, setVenue] = useState(event.venue ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const path = `/e/${event.slug}`

  function saveContent() {
    setError(null)
    startTransition(async () => {
      const result = await updateTournamentEventContent(event.id, {
        description: description || null,
        rules: rules || null,
        venue: venue || null,
      })
      if (result.error) setError(result.error)
      else {
        setEditingContent(false)
        router.refresh()
      }
    })
  }

  function togglePublish() {
    setError(null)
    startTransition(async () => {
      const result = await setEventPublished(event.id, !event.is_published)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  async function copyLink() {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sem `window.prompt` (ver CLAUDE.md): o caminho já está impresso logo
      // abaixo do nome do evento, então basta pedir a cópia manual.
      setError(`Não foi possível copiar. Copie à mão: ${url}`)
    }
  }

  return (
    <li className="rounded-xl border border-surface-border bg-surface/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{event.name}</span>
            <Badge variant={event.is_published ? 'success' : 'default'}>
              {event.is_published ? 'Publicado' : 'Rascunho'}
            </Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1 first-letter:uppercase">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {formatEventRange(event)}
            </span>
            <span className="flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {event.tournamentCount === 1 ? '1 torneio' : `${event.tournamentCount} torneios`}
            </span>
          </p>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{path}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditingContent((v) => !v)}>
            {editingContent ? 'Fechar' : 'Editar conteúdo'}
          </Button>
          <Button variant="ghost" size="sm" onClick={copyLink}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copiado' : 'Copiar link'}
          </Button>
          {/* target="_blank": a capa é pública e o admin costuma abrir para
              conferir antes de postar — não vale perder o painel. */}
          <a href={path} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink className="mr-1 h-4 w-4" />
              Abrir
            </Button>
          </a>
          <Button
            variant={event.is_published ? 'secondary' : 'primary'}
            size="sm"
            loading={isPending}
            onClick={togglePublish}
          >
            {event.is_published ? 'Despublicar' : 'Publicar'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {editingContent && (
        <div className="mt-3 space-y-2 rounded-lg border border-surface-border bg-surface/60 p-3">
          <EventCoverField eventId={event.id} initialUrl={event.cover_image_url} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">
              Regulamento <span className="text-slate-500">(herdado por todos os torneios sem regulamento próprio)</span>
            </label>
            <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3} className={inputClass} />
          </div>
          <Input label="Local" value={venue} onChange={(e) => setVenue(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveContent} loading={isPending}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * A capa da página do evento. É o flyer que vai no preview do WhatsApp e no
 * topo da página — a coluna existia e a página já a desenhava, mas não havia
 * onde enviar a imagem, então todo evento saía com o degradê de fallback.
 *
 * Mesmo caminho da capa do torneio (`CoverImageCard`): o navegador sobe o
 * arquivo ao bucket público e a action só grava a URL.
 */
function EventCoverField({ eventId, initialUrl }: { eventId: string; initialUrl: string | null }) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // 5 MB: acima disso o celular de quem abre o link espera a capa carregar
    // antes de ver qualquer coisa, e o WhatsApp desiste do preview.
    if (file.size > 5 * 1024 * 1024) {
      setError('Imagem muito grande. Use até 5 MB.')
      return
    }
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `eventos/${eventId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('tournament-images').upload(path, file)
      if (upErr) { setError('Erro ao enviar a imagem. Tente de novo.'); return }
      const publicUrl = supabase.storage.from('tournament-images').getPublicUrl(path).data.publicUrl
      const r = await updateTournamentEventCover(eventId, publicUrl)
      if (r.error) { setError(r.error); return }
      setUrl(publicUrl)
      router.refresh()
    })
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      const r = await updateTournamentEventCover(eventId, null)
      if (r.error) { setError(r.error); return }
      setUrl(null)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-slate-300">Capa da página</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-64 w-full rounded-lg object-contain bg-black/20" />
      ) : (
        <p className="text-xs text-slate-500">
          Sem capa, a página abre com um degradê e o link vai sem imagem no WhatsApp.
          Use o flyer do evento — quadrado ou retrato funciona melhor no celular.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer">
          <span className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            {isPending ? 'Enviando…' : url ? 'Trocar capa' : 'Enviar capa'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFile}
            disabled={isPending}
          />
        </label>
        {url && (
          <Button variant="danger" size="sm" disabled={isPending} onClick={remove}>
            Remover
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
