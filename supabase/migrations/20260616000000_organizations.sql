-- Fundação multi-tenant (Plano 1) — parte 1/5
-- Cria a tabela organizations (cada academia/quadra é uma org), adiciona o papel
-- super_admin (dono da plataforma) e a função auth_org_id() usada por toda a RLS.

-- 1. Papel de plataforma. Hierarquia: super_admin > admin (dono da academia) > student.
-- ADD VALUE é seguro fora de uso no mesmo statement; não referenciamos o valor aqui.
alter type user_role add value if not exists 'super_admin';

-- 2. Tabela de academias.
create table if not exists organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text unique not null,
  invite_code  text unique not null,
  logo_url     text,
  brand_color  text,
  status       text not null default 'active' check (status in ('active', 'suspended')),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Garante no máximo uma org marcada como default (fallback do cadastro até o Plano 2).
create unique index if not exists organizations_one_default
  on organizations (is_default) where is_default;

-- 3. auth_org_id() lê profiles.organization_id, então a coluna precisa existir antes
-- da função ser validada na criação. A parte 2/5 (000100) re-adiciona com IF NOT EXISTS
-- em todas as tabelas; aqui garantimos só profiles para destravar a função e a policy.
alter table profiles add column if not exists organization_id uuid references organizations(id);

-- 4. Função central da RLS: organização do usuário autenticado.
-- SECURITY DEFINER + search_path fixo: lê profiles sem disparar recursão de RLS
-- (mesmo motivo do fix em 20260615020000). STABLE pois não escreve.
create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

-- 4. RLS da própria tabela organizations.
alter table organizations enable row level security;

-- Usuário autenticado lê apenas a própria academia (branding, nome, etc.).
drop policy if exists "Members view own organization" on organizations;
create policy "Members view own organization" on organizations
  for select using (id = auth_org_id());

-- Escrita/gestão de academias é feita via service role (createAdminClient) pelo
-- super-admin; nenhuma policy de escrita é exposta ao papel authenticated.
