// features/home/NextClassCard.tsx
import Link from 'next/link'
import { Clock, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Countdown } from '@/components/ui/Countdown'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'

interface NextClassCardProps {
  className_: string
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM:SS' */
  startTime: string
  endTime: string
  booked: number
  capacity: number
  /** Reserva confirmada do aluno, ou uma aula que ele ainda pode entrar. */
  state: 'booked' | 'available'
  href: string
  isToday: boolean
}

/**
 * O card de topo da home: qual é a próxima aula e quanto falta para ela.
 * A contagem regressiva é o elemento principal — é a informação que o aluno
 * abre o app para ver.
 */
export function NextClassCard({
  className_,
  date,
  startTime,
  endTime,
  booked,
  capacity,
  state,
  href,
  isToday,
}: NextClassCardProps) {
  const startsAt = `${date}T${startTime}`
  const endsAt = `${date}T${endTime}`
  const spotsLeft = Math.max(capacity - booked, 0)

  return (
    <Link href={href} className="group block">
      <div className="glass relative overflow-hidden rounded-3xl border border-brand-500/30 p-5 shadow-[0_20px_50px_-30px_rgb(var(--brand-500)/0.9)] transition-transform duration-300 group-hover:-translate-y-0.5">
        {/* Brilho de fundo puxando a cor da academia para o canto do card. */}
        <div
          aria-hidden
          className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-brand-500/20 blur-3xl"
        />

        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="pulse-halo absolute inline-flex h-full w-full rounded-full bg-brand-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-300">
                {state === 'booked' ? 'Sua próxima aula' : 'Próxima aula disponível'}
              </span>
            </span>
            {state === 'booked' ? (
              <Badge variant="success">Confirmada</Badge>
            ) : spotsLeft > 0 ? (
              <Badge variant="default">
                {spotsLeft} {spotsLeft === 1 ? 'vaga' : 'vagas'}
              </Badge>
            ) : (
              <Badge variant="danger">Lotada</Badge>
            )}
          </div>

          <div className="mt-4 flex items-start gap-4">
            <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-center">
              <p className="text-xl font-extrabold leading-none text-white">
                {formatTime(startTime)}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                até {formatTime(endTime)}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-white">{className_}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {isToday ? 'Hoje' : formatDate(date, "EEEE, d 'de' MMM")}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-extrabold text-brand-400">
                <Clock className="h-4 w-4" />
                <Countdown startsAt={startsAt} endsAt={endsAt} />
              </p>
            </div>
          </div>

          <div className="mt-4">
            <OccupancyBar booked={booked} capacity={capacity} />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {booked} de {capacity} lugares ocupados
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-brand-400 transition-transform group-hover:translate-x-0.5">
                {state === 'booked' ? 'Ver aula' : 'Garantir vaga'}
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
