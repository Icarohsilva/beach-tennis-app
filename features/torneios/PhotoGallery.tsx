// features/torneios/PhotoGallery.tsx
import Image from 'next/image'
import { Card } from '@/components/ui/Card'
import type { TournamentPhotoView } from './photoQueries'

interface Props {
  photos: TournamentPhotoView[]
  title?: string
  /** Texto quando não há foto. Ausente = o bloco some. */
  emptyText?: string
}

/**
 * Galeria do mural. Sem curtida e sem comentário de propósito (a spec chama de YAGNI):
 * o valor aqui é ver a foto, e cada interação a mais é mais moderação para a academia.
 */
export function PhotoGallery({ photos, title = 'FOTOS', emptyText }: Props) {
  if (photos.length === 0 && !emptyText) return null

  return (
    <Card>
      <p className="mb-3 text-xs tracking-wide text-slate-400">{title}</p>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {photos.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg">
              <Image
                src={photo.url}
                alt={photo.caption ?? 'Foto do torneio'}
                fill
                sizes="(max-width: 768px) 33vw, 200px"
                className="object-cover"
              />
              {photo.caption && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {photo.caption}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
