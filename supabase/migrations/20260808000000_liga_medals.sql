-- Liga Fase 2: medalhas (spec 2026-08-02-liga-gamificacao-aluno §Fase 2).
--
-- Medalha NÃO dá ponto. Se desse, cada medalha nova do catálogo seria uma alavanca de
-- inflação retroativa sobre o ranking de quem já jogou. Ela é reconhecimento, e vive
-- fora do par extrato/cache de liga_points.
--
-- O catálogo (quais medalhas existem e o que cada uma exige) mora em código, em
-- lib/liga/medals.ts: é regra, não dado. Aqui fica só o que foi conquistado.

create table if not exists liga_medals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  student_id       uuid not null references profiles(id) on delete cascade,
  -- Chave do catálogo em lib/liga/medals.ts. Sem FK e sem check: o catálogo muda com
  -- deploy, e uma constraint aqui transformaria renomear uma medalha em migration.
  medal_key        text not null,
  -- null = medalha global (tempo de casa). Preenchido = medalha daquela modalidade.
  sport            text,
  earned_at        timestamptz not null default now(),
  -- null = o aluno ainda não viu; é o que dispara a comemoração na próxima abertura.
  seen_at          timestamptz
);

-- Uma medalha por aluno por escopo. coalesce porque `sport` nulo (medalha global)
-- não desempata em índice único comum — dois NULLs nunca colidem, e a medalha global
-- seria concedida de novo a cada passada do cron.
create unique index if not exists liga_medals_unique_idx
  on liga_medals (organization_id, student_id, medal_key, coalesce(sport, ''));

-- Vitrine do aluno e fila de comemoração.
create index if not exists liga_medals_student_idx
  on liga_medals (student_id, organization_id, earned_at desc);

alter table liga_medals enable row level security;

-- Leitura para membros da própria academia: a vitrine do colega faz parte do jogo.
-- Escrita nenhuma para authenticated — só o servidor concede (features/liga/medals.ts).
drop policy if exists liga_medals_read_own_org on liga_medals;
create policy liga_medals_read_own_org on liga_medals for select to authenticated
  using (organization_id in (
    select organization_id from memberships where user_id = auth.uid()
  ));

comment on table liga_medals is
  'Medalhas conquistadas na Liga. Catálogo de regras em lib/liga/medals.ts; medalha não dá ponto.';
