// lib/liga/labels.ts
// Rótulos da Liga em pt-BR, num lugar só: a divisão e o motivo do ponto aparecem
// na tela do aluno, no painel do professor e no extrato.
import type { Division } from './divisions'

export const DIVISION_LABEL: Record<Division, string> = {
  bronze: 'Divisão Bronze',
  prata: 'Divisão Prata',
  ouro: 'Divisão Ouro',
  diamante: 'Divisão Diamante',
}

export const POINT_REASON_LABEL: Record<string, string> = {
  attendance: 'Presença em aula',
  streak: 'Sequência de semanas',
  tournament_entry: 'Inscrição em torneio',
  tournament_result: 'Resultado de torneio',
  manual: 'Bônus da academia',
  kudos_given: 'Elogio enviado',
  kudos_received: 'Elogio recebido',
  self_checkin: 'Presença confirmada pelo app',
  cancel_in_time: 'Cancelou a tempo e liberou a vaga',
  waitlist_accept: 'Pegou vaga da fila de espera',
  early_booking: 'Agendou com antecedência',
  profile_complete: 'Cadastro completo',
  dayuse: 'Reserva de day use',
}
