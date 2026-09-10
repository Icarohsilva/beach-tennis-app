-- supabase/migrations/20260910120000_wallets.sql
-- Crédito em DINHEIRO por academia — a carteira do aluno.
--
-- Não confundir com `credit_transactions`, que conta AULAS. Aqui é real: nasce
-- do estorno de um day use que o aluno preferiu receber como crédito, e é gasto
-- em outro day use, na compra de créditos de aula ou numa inscrição de torneio.
--
-- Mesmo par ledger→cache do crédito de aula e da Liga: `wallet_transactions` é a
-- VERDADE e `wallets.balance_cents` é cache, escrito só pela RPC `wallet_apply`.
-- Recontar o saldo somando o extrato é sempre possível — é o que torna um cache
-- torto consertável em vez de irrecuperável.
--
-- Chaveada por (organization_id, student_id) e NÃO em `memberships`: o avulso que
-- reserva day use pela página pública não tem membership nenhuma (ver
-- 20260909-fase4 / CLAUDE.md) e precisa de saldo do mesmo jeito. Pendurar o saldo
-- na membership excluiria exatamente quem esta funcionalidade atende.
create table if not exists wallets (
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  balance_cents   int  not null default 0 check (balance_cents >= 0),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, student_id)
);

create table if not exists wallet_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  -- Assinado: positivo credita, negativo gasta. Zero não existe (nada aconteceu).
  amount_cents    int  not null check (amount_cents <> 0),
  reason          text not null,
  -- De onde veio / para onde foi. Texto livre + uuid em vez de FK por origem:
  -- são quatro origens hoje (estorno de day use, reserva de day use, compra de
  -- créditos, inscrição de torneio) e uma FK por origem viraria quatro colunas
  -- nulas na maioria das linhas.
  source_table    text,
  source_id       uuid,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists wallet_transactions_student_idx
  on wallet_transactions (organization_id, student_id, created_at desc);

-- Idempotência de quem tem origem: creditar o MESMO estorno duas vezes (retry de
-- action, duplo clique) daria dinheiro de graça. Parcial porque lançamento sem
-- origem (ajuste manual do admin) pode repetir legitimamente.
create unique index if not exists wallet_transactions_source_key
  on wallet_transactions (organization_id, student_id, reason, source_table, source_id)
  where source_id is not null;

alter table wallets enable row level security;
alter table wallet_transactions enable row level security;

-- Formato do 20260809000000_escala_rls_e_indices.sql: `(select ...)` avalia uma
-- vez por statement (InitPlan), não por linha.
drop policy if exists wallets_select_own on wallets;
create policy wallets_select_own on wallets
  for select to authenticated
  using (student_id = (select auth.uid()) or organization_id in (select auth_admin_org_ids()));

drop policy if exists wallet_transactions_select_own on wallet_transactions;
create policy wallet_transactions_select_own on wallet_transactions
  for select to authenticated
  using (student_id = (select auth.uid()) or organization_id in (select auth_admin_org_ids()));

-- Nenhuma policy de insert/update/delete, de propósito: escrita só pela RPC
-- abaixo (security definer, chamada com service role). Saldo que qualquer
-- cliente pudesse escrever não é saldo.

comment on table wallets is
  'Cache do saldo em dinheiro por (academia, aluno). Verdade é wallet_transactions; escrita só via wallet_apply.';
comment on table wallet_transactions is
  'Extrato do crédito em dinheiro. Positivo credita, negativo gasta. Crédito em dinheiro NÃO vence: é valor que o aluno pagou.';

-- ---------------------------------------------------------------------------
-- wallet_apply: o único jeito de mexer no saldo.
--
-- `for update` na linha de `wallets` antes de conferir o saldo é o ponto todo da
-- função: sem ele, duas reservas simultâneas leem o mesmo saldo, cada uma se
-- acha coberta e as duas gastam — o aluno paga uma e leva duas. Com o lock, a
-- segunda espera e vê o saldo já debitado.
--
-- Levanta INSUFFICIENT_BALANCE quando falta saldo (o caller traduz para o aluno)
-- e devolve o saldo resultante, para a tela não precisar de uma segunda leitura.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_apply(
  p_org uuid,
  p_student uuid,
  p_amount_cents int,
  p_reason text,
  p_source_table text default null,
  p_source_id uuid default null,
  p_created_by uuid default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_inserted int;
begin
  if p_amount_cents = 0 then
    raise exception 'WALLET_ZERO_AMOUNT';
  end if;

  -- Garante a linha do cache antes de travá-la: aluno sem carteira ainda é aluno
  -- com saldo zero, e `for update` não trava linha que não existe.
  insert into wallets (organization_id, student_id, balance_cents)
  values (p_org, p_student, 0)
  on conflict (organization_id, student_id) do nothing;

  select balance_cents into v_balance
    from wallets
   where organization_id = p_org and student_id = p_student
     for update;

  if p_amount_cents < 0 and v_balance + p_amount_cents < 0 then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  -- Extrato primeiro. `on conflict do nothing` + row_count é a mesma proteção de
  -- liga_award_points: origem já lançada não lança de novo nem move o cache.
  insert into wallet_transactions (
    organization_id, student_id, amount_cents, reason, source_table, source_id, created_by
  )
  values (
    p_org, p_student, p_amount_cents, p_reason, p_source_table, p_source_id, p_created_by
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return v_balance; -- já lançado: saldo atual, sem mexer no cache
  end if;

  update wallets
     set balance_cents = balance_cents + p_amount_cents,
         updated_at = now()
   where organization_id = p_org and student_id = p_student
  returning balance_cents into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.wallet_apply(uuid, uuid, int, text, text, uuid, uuid)
  from public, anon, authenticated;
