// features/home/agendaTypes.ts
// A aula como a agenda do aluno precisa dela. Mora em arquivo próprio porque é
// compartilhada entre a faixa da semana, a ficha em modal e o calendário — e um
// deles importar o outro só pelo tipo criaria ciclo.
import type { SelfCheckinView } from '@/features/checkin/selfCheckinQueries'

/**
 * Um dependente do responsável, com o que ele já tem NESTA sessão.
 *
 * `bookingId` presente = já está na aula (o botão é "Sair"); `waitlistEntryId`
 * presente = está na fila. Os dois ausentes = ainda pode entrar. Sem esses ids a
 * ficha só saberia dizer "entrar" e nunca desfazer.
 */
export interface GuardianOption {
  id: string
  name: string
  bookingId?: string
  waitlistEntryId?: string
}

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
  /**
   * Dependentes do responsável logado, quando ele tem algum. É o que permite ao
   * pai inscrever o filho na turma kids — o dependente não tem login, então sem
   * esta lista a aula dele apareceria na agenda sem nenhuma ação possível.
   */
  guardianOptions?: GuardianOption[]
  /**
   * O aluno tem plano com cota E crédito avulso, então pode escolher com o que
   * paga. Ausente quando só existe um caminho — perguntar seria ruído.
   */
  canChoosePayment?: boolean
  /** Saldo de crédito avulso do aluno, para a ficha explicar o que ele gasta. */
  creditsBalance?: number
  /**
   * A academia alterou esta data (horário, quadra ou capacidade) em relação à
   * turma. A ficha marca isso: sem o aviso, o aluno vê um horário diferente do
   * que combinou e não sabe se é mudança ou engano dele.
   */
  rescheduled?: boolean
  /**
   * A academia cancelou esta data.
   *
   * A aula continua na agenda, marcada, em vez de desaparecer: notificação se
   * perde, e sumir sem deixar rastro era o que fazia o aluno descobrir na quadra.
   * Com isto verdadeiro a ficha não oferece ação nenhuma — entrar, sair, fila e
   * confirmação de presença somem.
   */
  cancelled?: boolean
  /** Por que foi cancelada, quando a academia informou. */
  cancelledReason?: string | null
}
