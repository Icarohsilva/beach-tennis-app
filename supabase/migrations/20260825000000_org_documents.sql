-- supabase/migrations/20260825000000_org_documents.sql
-- Termos e comunicados obrigatórios por academia: a arena publica um documento
-- que o aluno é obrigado a ler (e, quando for o caso, assinar com CPF + nome)
-- antes de acessar qualquer outra coisa do app.
--
-- Desenho de prova copiado de legal_acceptances (20260724100000_legal_foundation.sql):
-- versão, ip_address como text (x-forwarded-for chega torto), user_agent, unique
-- triplo, RLS sem update/delete — registro de auditoria imutável. A diferença é
-- que ISTO é por academia (organization_id em toda tabela), então o conteúdo mora
-- no banco em vez de em código/git: cada arena escreve o próprio texto.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. org_documents — o documento como identidade (título, tipo, estado).
--    O TEXTO não mora aqui — ver org_document_versions.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists org_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  -- 'ack' = só precisa marcar como lido. 'sign' = lido + CPF + nome completo.
  kind text not null check (kind in ('ack', 'sign')),
  -- 'draft' nunca bloqueia ninguém. 'published' bloqueia quem não tem ack na
  -- versão corrente. 'archived' para de bloquear sem apagar o histórico de acks.
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz
);

-- Caminho quente do gate: "quais documentos published desta academia existem".
create index if not exists org_documents_published_idx
  on org_documents (organization_id)
  where status = 'published';

alter table org_documents enable row level security;

drop policy if exists org_documents_select_org on org_documents;
create policy org_documents_select_org on org_documents
  for select using (
    organization_id in (
      select organization_id from memberships where user_id = (select auth.uid())
    )
  );

drop policy if exists org_documents_admin_org on org_documents;
create policy org_documents_admin_org on org_documents
  for all using (organization_id in (select auth_admin_org_ids()));

comment on table org_documents is
  'Termo/comunicado publicável por academia. O texto de cada versão fica em org_document_versions — editar aqui nunca reescreve o que alguém já assinou.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. org_document_versions — o texto de cada versão, imutável.
--    Toda edição cria uma linha NOVA; nenhuma UPDATE de body depois de criada.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists org_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references org_documents(id) on delete cascade,
  version integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  unique (document_id, version)
);

alter table org_document_versions enable row level security;

drop policy if exists org_document_versions_select_org on org_document_versions;
create policy org_document_versions_select_org on org_document_versions
  for select using (
    exists (
      select 1 from org_documents d
      where d.id = document_id
        and d.organization_id in (
          select organization_id from memberships where user_id = (select auth.uid())
        )
    )
  );

drop policy if exists org_document_versions_admin_org on org_document_versions;
create policy org_document_versions_admin_org on org_document_versions
  for all using (
    exists (
      select 1 from org_documents d
      where d.id = document_id
        and d.organization_id in (select auth_admin_org_ids())
    )
  );

comment on table org_document_versions is
  'Texto imutável de cada versão de um org_document. Uma assinatura aponta para (document_id, version) — editar o documento nunca muda o que uma versão já publicada dizia.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. org_document_acks — a prova. Espelha legal_acceptances, com o que falta
--    para assinatura (signed_name/signed_cpf) e o snapshot de dependentes
--    cobertos pela assinatura do responsável.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists org_document_acks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references org_documents(id) on delete cascade,
  version integer not null,
  user_id uuid not null references profiles(id) on delete cascade,
  acked_at timestamptz not null default now(),
  -- text, não inet: mesmo motivo de legal_acceptances — x-forwarded-for às vezes
  -- chega em formato inesperado e nunca pode derrubar o insert por causa disso.
  ip_address text,
  user_agent text,
  -- Nulos quando org_documents.kind = 'ack'. Preenchidos só em 'sign'.
  signed_name text,
  signed_cpf text,
  -- Snapshot de quem eram os dependentes do responsável no momento da assinatura
  -- (decisão: "responsável assina 1x só" cobre ele e todos os filhos). Sem isto,
  -- um dependente que sair da academia depois deixaria a prova ambígua sobre
  -- quem exatamente a assinatura cobriu.
  covered_dependents jsonb,
  unique (user_id, document_id, version)
);

create index if not exists org_document_acks_document_idx
  on org_document_acks (document_id, version);

alter table org_document_acks enable row level security;

drop policy if exists org_document_acks_select_own on org_document_acks;
create policy org_document_acks_select_own on org_document_acks
  for select using (user_id = (select auth.uid()));

drop policy if exists org_document_acks_select_admin_org on org_document_acks;
create policy org_document_acks_select_admin_org on org_document_acks
  for select using (organization_id in (select auth_admin_org_ids()));

drop policy if exists org_document_acks_insert_own on org_document_acks;
create policy org_document_acks_insert_own on org_document_acks
  for insert with check (user_id = (select auth.uid()));
-- Sem policy de update/delete: registro de auditoria imutável, mesmo motivo de
-- legal_acceptances. Escrita real acontece via createAdminClient
-- (features/documentos/actions.ts), que bypassa RLS de qualquer forma; as
-- policies acima cobrem o caso (não usado hoje) de insert/select direto do client.

comment on table org_document_acks is
  'Prova de leitura/assinatura de um org_document, por (user_id, document_id, version). Imutável — editar o documento cria versão nova em vez de tocar aqui.';
