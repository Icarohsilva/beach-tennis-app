-- Multi-vínculo (Plano 1) — parte 1/4
-- Cria memberships (uma linha por pessoa × academia) com TODOS os campos por-academia
-- que hoje vivem em profiles. Cria auth_org_ids() (conjunto de orgs do usuário) e
-- is_org_admin(org) (papel admin naquela org), que substituem auth_org_id()/is_admin()
-- na RLS. Migração aditiva: profiles continua intacto (fonte dupla até o Plano 3).

-- 1. Tabela de vínculos.
create table if not exists memberships (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles(id) on delete cascade,
  organization_id        uuid not null references organizations(id) on delete cascade,
  role                   user_role not null default 'student',
  level                  student_level not null default 'iniciante',
  payment_type           payment_type not null default 'per_class',
  is_dependent           boolean not null default false,
  parent_id              uuid references profiles(id) on delete set null,
  contract_active        boolean not null default true,
  credits_balance        int not null default 0,
  monthly_checkin_target int not null default 0,
  pending_partner        checkin_partner,
  wellhub_id             text,
  totalpass_id           text,
  created_at             timestamptz not null default now(),
  unique (user_id, organization_id)
);

-- Índices para os caminhos quentes da RLS e das leituras por academia.
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists memberships_org_idx on memberships (organization_id);

-- 2. Conjunto de orgs do usuário autenticado. SECURITY DEFINER + search_path fixo:
-- lê memberships sem disparar recursão de RLS (mesmo motivo de auth_org_id()).
create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from memberships where user_id = auth.uid();
$$;

-- 3. O usuário é admin NAQUELA academia? Substitui is_admin() (que era global).
create or replace function is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and organization_id = p_org and role = 'admin'
  );
$$;

-- 4. RLS da própria memberships.
alter table memberships enable row level security;

drop policy if exists "memberships_select_own" on memberships;
drop policy if exists "memberships_select_admin_org" on memberships;

-- Cada um lê os próprios vínculos (necessário para a tela de seleção do Plano 2/3).
create policy "memberships_select_own" on memberships
  for select using (user_id = auth.uid());

-- Admin lê os vínculos da própria academia (gestão de alunos).
create policy "memberships_select_admin_org" on memberships
  for select using (is_org_admin(organization_id));

-- Escrita de memberships é via service role (createAdminClient) / triggers; nenhuma
-- policy de insert/update/delete é exposta ao papel authenticated.
