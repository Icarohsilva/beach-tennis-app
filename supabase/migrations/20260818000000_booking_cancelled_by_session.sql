-- Marca a reserva que caiu porque a ACADEMIA cancelou a aula.
--
-- Existe para uma pergunta que o reabrir precisa responder e não conseguia:
-- "quais destas reservas canceladas devem voltar quando a aula voltar?".
--
-- `admin_waived` não serve como resposta, apesar de parecer. Ela tem três
-- escritores, e só o primeiro deve ser revertido:
--
--   refundSessionBookings        → academia cancelou a aula        → deve voltar
--   removeStudentFromSession     → professor tirou o aluno da data → NÃO
--   cancelBookings               → aluno saiu da turma             → NÃO
--
-- Sem esta coluna, reabrir uma aula traria de volta o aluno que o professor
-- tinha tirado dela de propósito. Inferir pela ausência de registro de presença
-- funcionaria hoje e quebraria calado no próximo fluxo que cancelar reserva.
--
-- Aditiva e default false: nenhuma reserva existente muda de significado.
-- Reserva cancelada antes desta migração não volta em reabertura — o que é o
-- comportamento de hoje, e o conservador.

alter table session_bookings
  add column if not exists cancelled_by_session boolean not null default false;

comment on column session_bookings.cancelled_by_session is
  'A reserva foi cancelada porque a academia cancelou a aula (não pelo aluno nem por remoção pontual). É o conjunto que a reabertura da aula reverte.';

-- Índice parcial: a leitura é sempre "as reservas assim DESTA sessão", no
-- momento de reabrir. Parcial porque a marca é rara — a esmagadora maioria das
-- reservas nunca foi cancelada pela academia.
create index if not exists idx_session_bookings_cancelled_by_session
  on session_bookings (session_id)
  where cancelled_by_session = true;
