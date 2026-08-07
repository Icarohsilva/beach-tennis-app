-- Reserva isenta da cota por decisão do professor.
--
-- Quando o professor remove um aluno da aula ele escolhe se devolve a aula ou
-- se ela é consumida. Para quem paga com crédito "devolver" é estorno. Para
-- quem é de plano ou de parceiro não existe crédito: o que precisa voltar é a
-- CONTAGEM — a aula não pode entrar no total do ciclo, para o aluno usá-la em
-- outro dia.
--
-- Sem esta coluna não dava para expressar isso. resolveQuota conta como usada
-- a reserva cancelada em cima da hora (cancelledLate), e a remoção pelo
-- professor acontece justamente perto do horário — ou seja, hoje ela sempre
-- consome. A flag é explícita de propósito: a alternativa seria forjar
-- cancelled_at para uma hora que passasse na janela, escondendo a decisão real
-- dentro de um timestamp mentiroso.

alter table session_bookings
  add column if not exists admin_waived boolean not null default false;

comment on column session_bookings.admin_waived is
  'Professor devolveu a aula ao remover o aluno: não conta na cota do ciclo, mesmo cancelada em cima da hora.';

-- A cota varre as reservas do ciclo por aluno; a flag entra nesse filtro.
create index if not exists idx_session_bookings_admin_waived
  on session_bookings (student_id, admin_waived)
  where admin_waived = true;
