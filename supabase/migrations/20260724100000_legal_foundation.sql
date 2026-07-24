-- supabase/migrations/20260724100000_legal_foundation.sql
-- Fundação legal/contratual (Termos, Privacidade, Contrato SaaS, DPA, Cookies):
-- aceite versionado + solicitações de exclusão de conta e de reembolso/arrependimento.
-- O conteúdo dos documentos vive em docs/legal/*.md + lib/legal/documents.ts (código/git),
-- não no banco — aqui só registramos o EVENTO de aceite/solicitação, para auditoria.

-- Aceite versionado. Sem FK para uma tabela "documents": doc_slug é validado pela
-- server action contra lib/legal/documents.ts, não por constraint de banco.
create table if not exists legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  doc_slug    text not null,
  version     integer not null,
  accepted_at timestamptz not null default now(),
  -- text, não inet: x-forwarded-for às vezes chega em formato inesperado (múltiplos
  -- IPs, IPv6 com escopo) — nunca falha o insert por causa disso.
  ip_address  text,
  user_agent  text,
  unique (user_id, doc_slug, version)
);

create index if not exists idx_legal_acceptances_user on legal_acceptances(user_id);

alter table legal_acceptances enable row level security;

drop policy if exists "legal_acceptances_select_own" on legal_acceptances;
create policy "legal_acceptances_select_own" on legal_acceptances
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "legal_acceptances_select_platform_admin" on legal_acceptances;
create policy "legal_acceptances_select_platform_admin" on legal_acceptances
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin = true)
  );

drop policy if exists "legal_acceptances_insert_own" on legal_acceptances;
create policy "legal_acceptances_insert_own" on legal_acceptances
  for insert to authenticated with check (user_id = auth.uid());
-- Sem policy de update/delete: registro de auditoria imutável. Escrita real acontece
-- via createAdminClient (features/legal/actions.ts), que bypassa RLS de qualquer forma;
-- as policies acima cobrem o caso (não usado hoje) de insert/select direto do client.

-- Solicitação de exclusão de conta. Registra o PEDIDO; a execução técnica (anonimizar/
-- deletar dados) é manual e deliberada — este projeto já teve bugs sérios de FK em
-- purges destrutivas automatizadas, então deleção em cascata automática fica de fora
-- de propósito.
create table if not exists account_deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  reason          text,
  status          text not null default 'pendente'
                    check (status in ('pendente','em_andamento','concluida','cancelada')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists idx_account_deletion_status on account_deletion_requests(status, created_at desc);

alter table account_deletion_requests enable row level security;

drop policy if exists "account_deletion_insert_own" on account_deletion_requests;
create policy "account_deletion_insert_own" on account_deletion_requests
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "account_deletion_select_own" on account_deletion_requests;
create policy "account_deletion_select_own" on account_deletion_requests
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "account_deletion_select_platform_admin" on account_deletion_requests;
create policy "account_deletion_select_platform_admin" on account_deletion_requests
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin = true)
  );

drop policy if exists "account_deletion_update_platform_admin" on account_deletion_requests;
create policy "account_deletion_update_platform_admin" on account_deletion_requests
  for update to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin = true)
  );

-- Solicitação de reembolso/arrependimento da assinatura da plataforma (art. 49 CDC).
-- NÃO chama a API de refund do Mercado Pago automaticamente — mover dinheiro é decisão
-- humana; o time da plataforma processa manualmente e marca o status aqui (trilha de
-- auditoria do direito, não automação de reembolso).
create table if not exists platform_refund_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by    uuid not null references profiles(id),
  reason          text,
  status          text not null default 'pendente'
                    check (status in ('pendente','aprovada','recusada','reembolsada')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id)
);

create index if not exists idx_platform_refund_status on platform_refund_requests(status, created_at desc);

alter table platform_refund_requests enable row level security;

drop policy if exists "platform_refund_insert_owner" on platform_refund_requests;
create policy "platform_refund_insert_owner" on platform_refund_requests
  for insert to authenticated with check (
    exists (
      select 1 from organizations o
      where o.id = organization_id and o.owner_id = auth.uid()
    )
  );

drop policy if exists "platform_refund_select_owner" on platform_refund_requests;
create policy "platform_refund_select_owner" on platform_refund_requests
  for select to authenticated using (
    exists (
      select 1 from organizations o
      where o.id = organization_id and o.owner_id = auth.uid()
    )
  );

drop policy if exists "platform_refund_select_platform_admin" on platform_refund_requests;
create policy "platform_refund_select_platform_admin" on platform_refund_requests
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin = true)
  );

drop policy if exists "platform_refund_update_platform_admin" on platform_refund_requests;
create policy "platform_refund_update_platform_admin" on platform_refund_requests
  for update to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin = true)
  );
