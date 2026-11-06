-- Aula experimental passa a criar acesso e a valer uma por CPF.
--
-- O QUE MUDA:
--   * trial_bookings.cpf: só dígitos. Uma experimental por CPF em cada academia,
--     garantida no banco pelo índice parcial abaixo (duas abas enviando juntas não
--     passam as duas pela checagem da action).
--   * trial_bookings.student_id: a conta criada (ou já existente) de quem marcou.
--     Com ela a experimental vira uma reserva normal em session_bookings, e é por
--     este vínculo que a chamada mostra a tag "Experimental". Linhas antigas ficam
--     com student_id nulo: eram só nome/e-mail/telefone, sem conta.
--
-- Cancelada não conta: é como o admin libera uma nova experimental para a mesma
-- pessoa (o "Excluir" do painel apaga a linha, o que também libera).
alter table public.trial_bookings add column if not exists cpf text;
alter table public.trial_bookings
  add column if not exists student_id uuid references public.profiles(id) on delete set null;

create unique index if not exists trial_bookings_org_cpf_key
  on public.trial_bookings (organization_id, cpf)
  where cpf is not null and status <> 'cancelled';

create unique index if not exists trial_bookings_org_student_key
  on public.trial_bookings (organization_id, student_id)
  where student_id is not null and status <> 'cancelled';

-- A chamada procura as experimentais de uma sessão.
create index if not exists trial_bookings_session_idx on public.trial_bookings (session_id);

comment on column public.trial_bookings.cpf is
  'CPF (só dígitos) de quem marcou. Uma experimental por CPF por academia.';
comment on column public.trial_bookings.student_id is
  'Conta de quem marcou. A experimental é a reserva desta pessoa em session_bookings.';
