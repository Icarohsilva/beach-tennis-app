-- Lista de espera: conserta o drift de schema e a regra de re-entrada na fila.
--
-- 1) A migration original (20260602000000_waitlists.sql) NUNCA foi aplicada em
--    produção — o app referencia `waitlists` mas a tabela não existe lá, então
--    entrar na fila de uma turma lotada sempre falhava. Três migrations já
--    carregavam guardas `to_regclass` reconhecendo esse drift
--    (20260616000500, 20260621000200, 20260718000000). Aqui a tabela é criada
--    de forma idempotente, já na forma moderna (com organization_id), para
--    finalmente existir em todo ambiente.
--
-- 2) `unique(session_id, student_id)` era global: quem entrava na fila e saía
--    (status 'cancelled'), ou perdia o prazo de 1h ('expired'), ficava com a
--    linha morta no banco e NUNCA mais conseguia voltar para a fila daquela
--    sessão — o insert batia na constraint e devolvia o erro genérico
--    "Erro ao entrar na lista de espera". Trocado por um índice único PARCIAL,
--    que só vale para os status ativos ('waiting','offered'): uma pessoa tem no
--    máximo uma posição ativa, mas pode reentrar depois de sair.

create table if not exists waitlists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  position int not null default 1,
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'accepted', 'expired', 'cancelled')),
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Ambientes que já tinham a tabela (dev/staging) podem estar sem organization_id
-- ou com a constraint antiga. Alinha os dois casos.
alter table waitlists add column if not exists organization_id uuid references organizations(id) on delete cascade;

-- Derruba a unicidade global (nome gerado pelo Postgres na migration original).
alter table waitlists drop constraint if exists waitlists_session_id_student_id_key;

-- Unicidade só entre as entradas ATIVAS — permite reentrar após sair/expirar.
create unique index if not exists waitlists_active_unique
  on waitlists (session_id, student_id)
  where status in ('waiting', 'offered');

create index if not exists waitlists_session_status_idx
  on waitlists (session_id, status, joined_at);
create index if not exists waitlists_student_idx on waitlists (student_id);
create index if not exists waitlists_org_idx on waitlists (organization_id);

alter table waitlists enable row level security;

-- Políticas org-scoped, no mesmo formato de 20260621000200_rls_memberships_scoped.sql
-- (que só conseguia aplicá-las quando a tabela existia).
drop policy if exists "student_select_own_waitlist" on waitlists;
drop policy if exists "student_insert_own_waitlist" on waitlists;
drop policy if exists "student_update_own_waitlist" on waitlists;
drop policy if exists "admin_all_waitlists" on waitlists;
drop policy if exists "waitlists_select_own" on waitlists;
drop policy if exists "waitlists_insert_own" on waitlists;
drop policy if exists "waitlists_update_own" on waitlists;
drop policy if exists "waitlists_admin_org" on waitlists;

create policy "waitlists_select_own" on waitlists
  for select using (student_id = auth.uid());
create policy "waitlists_insert_own" on waitlists
  for insert with check (
    student_id = auth.uid() and organization_id in (select auth_org_ids())
  );
create policy "waitlists_update_own" on waitlists
  for update using (student_id = auth.uid());
create policy "waitlists_admin_org" on waitlists
  for all using (is_org_admin(organization_id));
