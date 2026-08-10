// features/home/agendaTypes.ts
// A aula como a agenda do aluno precisa dela. Mora em arquivo próprio porque é
// compartilhada entre a faixa da semana, a ficha em modal e o calendário — e um
// deles importar o outro só pelo tipo criaria ciclo.
import type { SelfCheckinView } from '@/features/checkin/selfCheckinQueries'

export interface AgendaSession {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  className: string
  /** 'HH:MM:SS' */
  start: string
  end: string
  booked: number
  capacity: number
  /** O aluno já tem reserva confirmada nesta sessão. */
  mine: boolean
  /** O aluno é aluno fixo da turma. */
  fixed: boolean
  kids: boolean
  /** Modalidade da turma (slug). Rótulo — não restringe quem pode reservar. */
  sport: string | null
  /** Nomes de quem é esperado na aula (fixos + reservas). */
  attendees: string[]
  /** Nomes de quem está na fila de espera, em ordem de chegada. */
  waitlist: string[]
  /** Entrada do aluno na fila desta sessão, quando existe — necessária para sair. */
  waitlistEntryId?: string
  /** Reserva do aluno nesta sessão, quando existe — necessária para sair. */
  bookingId?: string
  /** A reserva do aluno veio da matrícula fixa (sai devolvendo crédito). */
  fromEnrollment?: boolean
  /**
   * Retrato da confirmação de presença pelo app nesta sessão. Ausente quando a
   * academia não habilitou o recurso ou a aula não é do aluno.
   */
  selfCheckin?: SelfCheckinView
}
