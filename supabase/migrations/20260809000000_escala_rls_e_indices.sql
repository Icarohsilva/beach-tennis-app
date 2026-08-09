-- 20260809000000_escala_rls_e_indices.sql
--
-- Preparo de escala do banco. Três blocos independentes:
--   1. auth.uid() vira (select auth.uid()) em toda policy
--   2. is_org_admin(col) vira col in (select auth_admin_org_ids())
--   3. índices compostos para os filtros que as telas realmente usam
--
-- Nada aqui muda QUEM enxerga O QUÊ. Os dois primeiros blocos são reescritas
-- equivalentes que mudam só o plano de execução; o terceiro só acrescenta índice.
--
-- Por que 1 e 2 importam: numa policy, `auth.uid()` chamada direto é reavaliada
-- LINHA A LINHA. Embrulhada em subquery, o planejador a transforma em InitPlan e
-- executa uma vez por statement. Mesma coisa com is_org_admin(organization_id):
-- como recebe uma coluna, roda por linha, e cada execução é um select em
-- memberships. Em tabela de 30 milhões de linhas isso é a diferença entre um
-- índice e um seq scan com função no meio.
--
-- VERIFICAÇÃO PÓS-DEPLOY (rodar no SQL editor, deve devolver 0 linhas):
--   select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and (qual ~ '(?<!select )auth\.uid\(\)' or with_check ~ '(?<!select )auth\.uid\(\)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Conjunto de academias em que o usuário é admin, como função stable.
--    Espelha auth_org_ids() (migração 20260621000000), mas filtrando role.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function auth_admin_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from memberships
  where user_id = (select auth.uid()) and role = 'admin';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 + 2. Reescreve as policies existentes.
--
-- Percorre pg_policies, aplica as duas substituições de texto e recria a policy
-- só quando o texto mudou. Roda dentro da transação da migração: se qualquer
-- CREATE POLICY falhar, tudo volta atrás e a RLS antiga permanece intacta.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  p record;
  novo_qual text;
  novo_check text;
  sql text;
  alteradas int := 0;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    novo_qual := p.qual;
    novo_check := p.with_check;

    -- auth.uid() → (select auth.uid()), sem embrulhar o que já está embrulhado.
    -- O Postgres renderiza a subquery como "( SELECT auth.uid() AS uid)", então o
    -- negative lookbehind de 'select ' cobre o caso já convertido.
    novo_qual := regexp_replace(novo_qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi');
    novo_check := regexp_replace(novo_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'gi');

    -- is_org_admin(<coluna>) → (<coluna> in (select auth_admin_org_ids()))
    -- O prefixo de schema é opcional porque pg_get_expr qualifica ou não conforme
    -- o search_path; sem o (?:public\.)? o replace deixaria um "public." órfão
    -- grudado num parêntese e o create policy abaixo falharia.
    -- Chamada com argumento que não seja uma coluna simples não casa e fica como
    -- está: continua correta, só não ganha o InitPlan.
    novo_qual := regexp_replace(
      novo_qual, '(?:public\.)?is_org_admin\(([a-z_][a-z0-9_]*)\)',
      '(\1 in (select auth_admin_org_ids()))', 'gi');
    novo_check := regexp_replace(
      novo_check, '(?:public\.)?is_org_admin\(([a-z_][a-z0-9_]*)\)',
      '(\1 in (select auth_admin_org_ids()))', 'gi');

    continue when novo_qual is not distinct from p.qual
             and novo_check is not distinct from p.with_check;

    sql := format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute sql;

    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename,
      case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      p.cmd,
      array_to_string(p.roles, ', ')
    );
    if novo_qual is not null then
      sql := sql || format(' using (%s)', novo_qual);
    end if;
    if novo_check is not null then
      sql := sql || format(' with check (%s)', novo_check);
    end if;

    execute sql;
    alteradas := alteradas + 1;
  end loop;

  raise notice 'policies reescritas para escala: %', alteradas;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índices compostos.
--
-- Os índices de hoje são quase todos de uma coluna só — em especial o
-- `<tabela>_org_idx` criado em lote na migração 20260616000100. Com uma academia
-- na base isso não aparece; com mil, filtrar por organization_id devolve milhões
-- de linhas e o resto do predicado vira filtro em memória.
--
-- Ordem das colunas: igualdade primeiro, faixa por último — é o que permite o
-- índice resolver `org = X and data between A and B` sem reordenar.
-- ─────────────────────────────────────────────────────────────────────────────

-- Painel do admin, grade e relatório: sempre org + dia (ou faixa de dias).
create index if not exists class_sessions_org_date_idx
  on class_sessions (organization_id, session_date);

-- Liga (sequência, medalhas, sumidos) e chamada: org + status da presença.
create index if not exists attendance_org_status_idx
  on attendance (organization_id, status);

-- Ocupação da sessão — o count mais chamado do sistema.
create index if not exists session_bookings_session_status_idx
  on session_bookings (session_id, status);

-- Cota do plano e histórico do aluno dentro da academia.
create index if not exists session_bookings_org_student_status_idx
  on session_bookings (organization_id, student_id, status);

-- Cron de expiração: o extrato é lido por (academia, aluno).
create index if not exists credit_transactions_org_student_idx
  on credit_transactions (organization_id, student_id);

-- Contagem de alunos ativos por academia (painel) e listagem de alunos.
create index if not exists memberships_org_role_idx
  on memberships (organization_id, role);

-- auth_org_ids()/auth_admin_org_ids() rodam em toda policy: precisam ser
-- lookup por índice, nunca scan.
create index if not exists memberships_user_role_idx
  on memberships (user_id, role);

-- Visão da Liga pela academia: contagem por temporada e motivo.
create index if not exists liga_points_season_reason_idx
  on liga_points (season_id, reason);

-- Sino de notificações do layout: as 20 mais recentes do usuário.
create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc);

-- Relatório de frequência varre as matrículas da academia inteira.
create index if not exists enrollments_org_student_idx
  on enrollments (organization_id, student_id);

-- Cron da fila: só interessa quem está esperando, que é fração minúscula da tabela.
create index if not exists waitlists_waiting_idx
  on waitlists (session_id) where status = 'waiting';
