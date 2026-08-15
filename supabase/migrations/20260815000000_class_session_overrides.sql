-- Editar uma aula JÁ GERADA, sem mexer na turma.
--
-- Até aqui `class_sessions` era só (turma, data, status, notas): horário, quadra e
-- capacidade viviam em `classes`, a turma recorrente. Isso significava que remarcar
-- a aula de uma terça específica — o professor viajou, choveu, a quadra 2 está
-- interditada — só era possível mudando a turma inteira, e a mudança valia para
-- todas as semanas seguintes. Na prática a academia não editava: cancelava a data e
-- avisava por WhatsApp.
--
-- O modelo aqui é override: NULO = herda a turma, preenchido = vale só naquela data.
-- Por isso todas as colunas nascem nulas e nenhuma linha existente precisa de
-- migração de dados — o estado atual do banco já é "tudo herdado".
--
-- O resolvedor único está em lib/aulas/sessionOverride.ts; nenhuma tela deve ler
-- `classes.start_time` direto para uma sessão, senão a aula remarcada aparece no
-- horário velho em algum canto (foi o que aconteceu com a capacidade antes).

alter table class_sessions add column if not exists start_time time;
alter table class_sessions add column if not exists end_time time;
alter table class_sessions add column if not exists court int;
alter table class_sessions add column if not exists max_students int;

-- Por que a aula daquele dia foi cancelada. Aparece para o aluno na agenda; sem
-- isto o cancelamento é mudo e a academia acaba avisando por fora do app de novo.
alter table class_sessions add column if not exists cancelled_reason text;

-- Capacidade zero ou negativa não é override, é engano: a tela avisa antes de
-- salvar, e aqui a trava fecha o caminho de quem escreve direto no banco.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'class_sessions_max_students_positive'
  ) then
    alter table class_sessions
      add constraint class_sessions_max_students_positive
      check (max_students is null or max_students > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'class_sessions_court_positive'
  ) then
    alter table class_sessions
      add constraint class_sessions_court_positive
      check (court is null or court > 0);
  end if;
end $$;

-- Horário parcial (só o início, sem o fim) deixaria a aula sem duração conhecida e
-- quebraria a janela de check-in, que precisa dos dois. Os dois andam juntos.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'class_sessions_time_override_pair'
  ) then
    alter table class_sessions
      add constraint class_sessions_time_override_pair
      check (
        (start_time is null and end_time is null)
        or (start_time is not null and end_time is not null and end_time > start_time)
      );
  end if;
end $$;

comment on column class_sessions.start_time is
  'Override do horário da turma NESTA data. Nulo = herda classes.start_time.';
comment on column class_sessions.end_time is
  'Override do horário da turma NESTA data. Anda em par com start_time.';
comment on column class_sessions.court is
  'Override da quadra NESTA data. Nulo = herda classes.court.';
comment on column class_sessions.max_students is
  'Override da capacidade NESTA data. Nulo = herda classes.max_students.';
comment on column class_sessions.cancelled_reason is
  'Motivo do cancelamento desta data, mostrado ao aluno.';
