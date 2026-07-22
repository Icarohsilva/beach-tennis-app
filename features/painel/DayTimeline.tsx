// features/painel/DayTimeline.tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Badge } from '@/components/ui/Badge'
import { OccupancyBar } from '@/components/ui/OccupancyBar'

export interface TimelineSession {
  id: string
  className: string
  /** 'HH:MM:SS' */
  start: string
  end: string
  booked: number
  capacity: number
  kids: boolean
}

/** Converte 'HH:MM:SS' em minutos desde a meia-noite. */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * As aulas do dia numa linha do tempo, com um marcador de "agora" que corre
 * junto com o relógio de quem está no balcão. Aula que já passou fica apagada;
 * a que está rolando ganha destaque.
 */
export function DayTimeline({ sessions }: { sessions: TimelineSession[] }) {
  const [nowMin, setNowMin] = useState<number | null>(null)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setNowMin(now.getHours() * 60 + now.getMinutes())
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  // Posição do marcador: antes da primeira aula que ainda não começou.
  const markerIndex =
    nowMin === null ? -1 : sessions.findIndex((s) => toMinutes(s.start) > nowMin)

  return (
    <ol className="relative space-y-2">
      {sessions.map((session, i) => {
        const startMin = toMinutes(session.start)
        const endMin = toMinutes(session.end)
        const isLive = nowMin !== null && nowMin >= startMin && nowMin < endMin
        const isDone = nowMin !== null && nowMin >= endMin

        return (
          <li key={session.id}>
            {markerIndex === i && nowMin !== null && (
              <NowMarker label={`${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}`} />
            )}

            <Link href={`/admin/grade/${session.id}`} className="group block">
              <div
                className={cn(
                  'glass relative overflow-hidden rounded-2xl border p-3.5 transition-all duration-200 group-hover:-translate-y-0.5',
                  isLive
                    ? 'border-brand-500/50 shadow-[0_16px_40px_-28px_rgb(var(--brand-500)/0.95)]'
                    : 'border-white/[0.07] group-hover:border-white/[0.14]',
                  isDone && 'opacity-55',
                )}
              >
                {isLive && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand-400 to-brand-700"
                  />
                )}

                <div className="flex items-center gap-3">
                  <div className="w-12 shrink-0 text-center">
                    <p className="text-sm font-extrabold leading-none text-white">
                      {session.start.slice(0, 5)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">{session.end.slice(0, 5)}</p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {session.className}
                      </p>
                      {session.kids && <Badge variant="kids">KIDS</Badge>}
                      {isLive && (
                        <span className="flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-300">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="pulse-halo absolute inline-flex h-full w-full rounded-full bg-brand-400" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
                          </span>
                          Em andamento
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <OccupancyBar
                        booked={session.booked}
                        capacity={session.capacity}
                        step={i}
                        className="max-w-[180px] flex-1"
                      />
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                        <Users className="h-3 w-3" />
                        {session.booked}/{session.capacity}
                      </span>
                    </div>
                  </div>

                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400 transition-colors group-hover:text-brand-400">
                    <span className="hidden sm:inline">Chamada</span>
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </Link>
          </li>
        )
      })}

      {/* Depois da última aula, o marcador fecha a lista. */}
      {markerIndex === -1 && nowMin !== null && sessions.length > 0 && (
        <li>
          <NowMarker label={`${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}`} />
        </li>
      )}
    </ol>
  )
}

function NowMarker({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5" suppressHydrationWarning>
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="pulse-halo absolute inline-flex h-full w-full rounded-full bg-brand-400" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-400">
        agora · {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-brand-500/50 to-transparent" />
    </div>
  )
}
