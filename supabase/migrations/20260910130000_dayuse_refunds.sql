-- supabase/migrations/20260910130000_dayuse_refunds.sql
-- Estorno de day use pago.
--
-- Até aqui cancelar day use pago não devolvia nada: `cancelDayUseBooking` só
-- marcava `cancelled` sem tocar em `payments`, e `deactivateDayUseSlot`
-- desativava o horário deixando as reservas órfãs — sem cancelamento, sem aviso
-- e sem devolução. Com a página pública (/d/[id]) existe caminho para estranho
-- pagar, então o buraco deixou de ser teórico.
--
-- Mover dinheiro continua sendo ato HUMANO: o app registra o que é devido,
-- guarda o comprovante e cobra a confirmação do aluno. Mesma escolha de
-- `platform_refund_requests` (20260724100000) — nada de chamar a API de refund
-- do Mercado Pago sozinho.

-- Chave PIX informada na RESERVA (opcional). Mora na reserva e não no estorno
-- porque é coletada antes de existir estorno nenhum; quando o estorno abre, ela
-- é copiada para lá e pode ser corrigida — chave digitada semanas antes
-- envelhece (troca de banco, erro de digitação).
alter table dayuse_bookings
  add column if not exists refund_pix_key text,
  add column if not exists refund_pix_owner text;

comment on column dayuse_bookings.refund_pix_key is
  'Chave PIX para estorno, informada na reserva. Copiada para dayuse_refunds.pix_key quando o estorno abre.';

create table if not exists dayuse_refunds (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Uma reserva gera no MÁXIMO um estorno, e é esta unicidade que torna
  -- openRefundForBooking idempotente (retry de action, duplo clique do admin,
  -- cancelamento em massa de um horário rodando duas vezes).
  booking_id      uuid not null unique references dayuse_bookings(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  -- Só a parte que entrou por GATEWAY. A parte paga com carteira volta para a
  -- carteira na hora do cancelamento e aparece no extrato dela — não passa por
  -- aqui, porque não há PIX a fazer para devolver crédito interno.
  amount_cents    int  not null check (amount_cents > 0),
  cause           text not null check (cause in ('arena_cancelou', 'aluno_cancelou')),
  -- Como o aluno quer receber. Só ELE troca para 'credito': empurrar
  -- vale-compra a quem tem direito a dinheiro é decisão que não é da academia.
  method          text not null default 'pix' check (method in ('pix', 'credito')),
  pix_key         text,
  pix_owner       text,
  -- pendente  → devido, ninguém pagou ainda (é aqui que dá para trocar por crédito)
  -- pago      → admin fez o PIX e anexou comprovante, esperando o aluno confirmar
  -- confirmado→ aluno confirmou que recebeu
  -- creditado → virou saldo na carteira (fim de linha, não passa por 'pago')
  status          text not null default 'pendente'
                    check (status in ('pendente', 'pago', 'confirmado', 'creditado')),
  proof_url       text,
  paid_at         timestamptz,
  paid_by         uuid references profiles(id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- Fila do admin: "o que eu devo, do mais antigo primeiro".
create index if not exists dayuse_refunds_org_status_idx
  on dayuse_refunds (organization_id, status, created_at);

create index if not exists dayuse_refunds_student_idx
  on dayuse_refunds (student_id, created_at desc);

alter table dayuse_refunds enable row level security;

-- O aluno lê o próprio estorno SEM depender de vínculo com a academia: o avulso
-- da página pública não tem membership (ver CLAUDE.md, day use fase 4) e é
-- justamente ele que precisa acompanhar o próprio dinheiro. Mesmo desenho de
-- `dayuse_bookings_select`.
-- Formato do 20260809000000: `(select auth.uid())` avalia uma vez por statement.
drop policy if exists dayuse_refunds_select_own on dayuse_refunds;
create policy dayuse_refunds_select_own on dayuse_refunds
  for select to authenticated
  using (student_id = (select auth.uid()) or organization_id in (select auth_admin_org_ids()));

-- Escrita só por server action com service role: o estorno decide quanto a
-- academia deve, e status é dinheiro. Nenhuma policy de insert/update.

comment on table dayuse_refunds is
  'O que a academia DEVE devolver por day use pago e cancelado. amount_cents cobre só a parte paga por gateway; a parte paga com carteira volta direto para a carteira.';
comment on column dayuse_refunds.status is
  'pendente = devido (aluno ainda pode trocar por crédito); pago = admin pagou e anexou comprovante; confirmado = aluno confirmou; creditado = virou saldo na carteira.';
