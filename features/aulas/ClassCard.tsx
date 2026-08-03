// features/aulas/ClassCard.tsx
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatTime } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import type { Class } from '@/types'

interface ClassCardProps {
  class_: Class
  enrolledCount: number
  onClick?: () => void
  accent?: boolean
}

export function ClassCard({ class_: c, enrolledCount, onClick, accent }: ClassCardProps) {
  const spotsLeft = c.max_students - enrolledCount
  const isFull = spotsLeft <= 0
  const isKids = c.type === 'kids'

  const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  return (
    <Card onClick={onClick} accent={accent}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-white font-semibold text-sm truncate">{c.name}</h3>
            {isKids && <Badge variant="kids">KIDS</Badge>}
          </div>

          {c.description && (
            <p className="text-slate-400 text-xs mb-2 line-clamp-2">{c.description}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{DAY_NAMES[c.day_of_week]}</span>
            <span>
              {formatTime(c.start_time)} – {formatTime(c.end_time)}
            </span>
            {/* Modalidade é rótulo: identifica a turma, não restringe quem entra. */}
            {c.sport && (
              <span className="text-slate-300">
                {sportEmoji(c.sport)} {sportLabel(c.sport)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {isFull ? (
            <Badge variant="danger">Lotada</Badge>
          ) : (
            <Badge variant={spotsLeft <= 3 ? 'warning' : 'success'}>
              {spotsLeft} {spotsLeft === 1 ? 'vaga' : 'vagas'}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}
