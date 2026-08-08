'use client'
// app/(admin)/admin/torneios/[id]/PhotosCard.tsx
// Mural de fotos do torneio, do lado da academia (spec §Fase 4).
import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { Trash2, Upload } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { uploadTournamentPhoto, deleteTournamentPhoto } from '@/features/torneios/photoActions'
import type { TournamentPhotoView } from '@/features/torneios/photoQueries'

interface Props {
  tournamentId: string
  photos: TournamentPhotoView[]
}

export function PhotosCard({ tournamentId, photos }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOk(null)
    const formData = new FormData(e.currentTarget)
    formData.set('tournament_id', tournamentId)

    startTransition(async () => {
      const result = await uploadTournamentPhoto(formData)
      if (result.error) setError(result.error)
      else {
        setOk(`${result.uploaded} foto(s) publicada(s) no mural.`)
        formRef.current?.reset()
      }
    })
  }

  function handleDelete(photoId: string) {
    setError(null)
    setOk(null)
    startTransition(async () => {
      const result = await deleteTournamentPhoto(photoId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <Card>
      <p className="mb-1 text-sm font-bold text-white">Mural de fotos</p>
      <p className="mb-3 text-xs text-slate-400">
        Só a academia sobe foto. Os alunos veem a galeria na página do torneio e na aba Liga.
      </p>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {ok && (
        <p className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
          {ok}
        </p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="mb-4 space-y-3">
        <input
          type="file"
          name="photos"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-border file:px-3 file:py-2 file:text-xs file:text-slate-200"
        />
        <Input name="caption" placeholder="Legenda (opcional), vale para todas do envio" />
        <Button type="submit" variant="primary" loading={pending}>
          <Upload className="mr-1.5 h-4 w-4" />
          Publicar no mural
        </Button>
      </form>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhuma foto ainda.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {photos.map((photo) => (
            <li key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg">
              <Image
                src={photo.url}
                alt={photo.caption ?? 'Foto do torneio'}
                fill
                sizes="120px"
                className="object-cover"
              />
              <button
                onClick={() => handleDelete(photo.id)}
                disabled={pending}
                title="Remover do mural"
                className="absolute right-1 top-1 rounded-lg bg-black/70 p-1 text-slate-200 transition-colors hover:bg-red-600 hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
