'use client'
// features/dayuse/DayUsePagesPanel.tsx
// "Páginas de day use" no painel: o link que a arena divulga no grupo, com o
// flyer no topo e as datas daquele day use dentro. Mesmo desenho do painel de
// páginas de evento dos torneios (app/(admin)/admin/torneios/EventsPanel.tsx).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Copy, ExternalLink, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClasses } from '@/components/ui/Button'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'
import {
  createDayUsePage,
  setDayUsePagePublished,
  updateDayUsePageContent,
  updateDayUsePageCover,
} from './pageActions'

export interface AdminDayUsePage {
  id: string
  name: string
  slug: string
  description: string | null
  cover_image_url: string | null
  is_published: boolean
  /** Datas futuras ativas vinculadas — é o que diz se dá para publicar. */
  upcomingCount: number
}

const inputClass =
  'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

export function DayUsePagesPanel({ pages }: { pages: AdminDayUsePage[] }) {
  const [creating, setCreating] = useState(false)

  return (
    // Fechado ao abrir a tela, como nos torneios: a agenda de datas, que é o
    // que o admin veio ver, fica logo embaixo.
    <CollapsibleCard
      title="Páginas de day use"
      subtitle="Um link com o flyer para divulgar; as datas ficam dentro dele."
      meta={`${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}`}
    >
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          {creating ? 'Fechar' : 'Nova página'}
        </Button>
      </div>

      {creating && <CreatePageForm onDone={() => setCreating(false)} />}

      {pages.length === 0 ? (
        !creating && (
          <p className="py-4 text-sm text-slate-400">
            Nenhuma página ainda. Crie uma para cada day use que lançar (ex: Day Use de Verão)
            e vincule as datas dele na lista abaixo.
          </p>
        )
      ) : (
        <ul className="mt-4 space-y-2">
          {pages.map((page) => (
            <PageRow key={page.id} page={page} />
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}

function CreatePageForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await createDayUsePage({ name, description: description || null })
      if (r.error) { setError(r.error); return }
      onDone()
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-xl border border-surface-border bg-surface/60 p-3">
      <Input
        label="Nome da página"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex: Day Use de Verão"
        required
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Descrição (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="O que a pessoa encontra: quadras, música, bar, como funciona…"
          className={inputClass}
        />
      </div>
      <p className="text-xs text-slate-500">
        A página nasce como rascunho. Depois de criar, suba o flyer, vincule as datas e publique.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={isPending}>
          Criar página
        </Button>
      </div>
    </form>
  )
}

function PageRow({ page }: { page: AdminDayUsePage }) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(page.name)
  const [description, setDescription] = useState(page.description ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const path = `/dayuse/${page.slug}`

  function save() {
    setError(null)
    startTransition(async () => {
      const r = await updateDayUsePageContent(page.id, { name, description: description || null })
      if (r.error) { setError(r.error); return }
      setEditing(false)
      router.refresh()
    })
  }

  function togglePublish() {
    setError(null)
    startTransition(async () => {
      const r = await setDayUsePagePublished(page.id, !page.is_published)
      if (r.error) setError(r.error)
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
      setError(`Não foi possível copiar. Copie à mão: ${url}`)
    }
  }

  return (
    <li className="rounded-xl border border-surface-border bg-surface/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{page.name}</span>
            <Badge variant={page.is_published ? 'success' : 'default'}>
              {page.is_published ? 'Publicada' : 'Rascunho'}
            </Badge>
          </div>
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {page.upcomingCount === 1 ? '1 data futura' : `${page.upcomingCount} datas futuras`}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{path}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Fechar' : 'Editar conteúdo'}
          </Button>
          <Button variant="ghost" size="sm" onClick={copyLink}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copiado' : 'Copiar link'}
          </Button>
          <a href={path} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink className="mr-1 h-4 w-4" />
              Abrir
            </Button>
          </a>
          <Button
            variant={page.is_published ? 'secondary' : 'primary'}
            size="sm"
            loading={isPending}
            onClick={togglePublish}
          >
            {page.is_published ? 'Despublicar' : 'Publicar'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-surface-border bg-surface/60 p-3">
          <PageCoverField pageId={page.id} initialUrl={page.cover_image_url} />
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={inputClass}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={isPending}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * O flyer da página: topo da página e preview do link no WhatsApp. O navegador
 * sobe ao bucket público `dayuse-images` e a action só grava a URL — o mesmo
 * caminho da capa de cada data (DayUseShareCard) e da capa do evento.
 */
function PageCoverField({ pageId, initialUrl }: { pageId: string; initialUrl: string | null }) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Imagem muito grande. Use até 5 MB.')
      return
    }
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `paginas/${pageId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('dayuse-images').upload(path, file)
      if (upErr) { setError('Erro ao enviar a imagem. Tente de novo.'); return }
      const publicUrl = supabase.storage.from('dayuse-images').getPublicUrl(path).data.publicUrl
      const r = await updateDayUsePageCover(pageId, publicUrl)
      if (r.error) { setError(r.error); return }
      setUrl(publicUrl)
      router.refresh()
    })
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      const r = await updateDayUsePageCover(pageId, null)
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
        <img src={url} alt="" className="max-h-64 w-full rounded-lg bg-black/20 object-contain" />
      ) : (
        <p className="text-xs text-slate-500">
          Sem capa, a página abre com um degradê e o link vai sem imagem no WhatsApp. Use o
          flyer do day use: quadrado ou retrato funciona melhor no celular.
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
