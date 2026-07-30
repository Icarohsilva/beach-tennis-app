-- Pendência de check-in de parceiro (spec 2026-07-30-controle-wellhub-pendencias).
--
-- O aluno Wellhub/TotalPass tinha aula reservada e o professor marcou AUSENTE na
-- chamada: a academia perdeu o repasse daquele check-in. Esta tabela é o registro
-- dessa perda, e o contador que alimenta o bloqueio configurável por academia.
--
-- NÃO confundir com:
--   * pending_checkins        — fila de check-in vindo do webhook cujo
--                              partner_member_id não casou com nenhum aluno;
--   * payments com session_id — pendência FINANCEIRA de aula avulsa
--                              (features/financeiro/classDebt.ts);
--   * memberships.pending_partner — parceiro autodeclarado no cadastro, à espera
--                              de confirmação do admin.

create table if not exists missed_checkins (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  student_id       uuid not null references profiles(id) on delete cascade,
  session_id       uuid not null references class_sessions(id) on delete cascade,
  partner          checkin_partner not null,
  -- Desnormalizado de propósito: a mensagem de WhatsApp e a ordenação da tela de
  -- controle listam datas, e sem isso toda leitura viraria join com class_sessions.
  session_date     date not null,
  -- Reais, congelado no momento da falta: mudar o preço depois não reescreve o
  -- histórico (mesma unidade de partner_checkin_rates.value).
  amount           numeric(10,2) not null default 0,
  status           text not null default 'open' check (status in ('open','paid','waived')),
  -- payments criado quando amount > 0, para reusar as trilhas de pagamento que já
  -- existem (PIX+comprovante, Mercado Pago, dar baixa). null quando amount = 0.
  payment_id       uuid references payments(id) on delete set null,
  resolved_at      timestamptz,
  resolved_by      uuid references profiles(id),
  resolution_note  text,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now()
);

-- Idempotência: marcar ausente duas vezes não duplica. 23505 é o caminho feliz,
-- não erro (mesmo padrão de payments_session_student_unique).
create unique index if not exists missed_checkins_student_session_idx
  on missed_checkins (student_id, session_id);

create index if not exists missed_checkins_org_status_idx
  on missed_checkins (organization_id, status);

-- Contagem de pendências abertas do aluno: caminho quente do bloqueio, chamado em
-- toda reserva.
create index if not exists missed_checkins_student_org_status_idx
  on missed_checkins (student_id, organization_id, status);

alter table missed_checkins enable row level security;

-- Leitura: admin da academia (tela de controle) + o próprio aluno (dashboard).
-- Escrita: só service role, via as server actions.
drop policy if exists "missed_checkins_admin_org" on missed_checkins;
create policy "missed_checkins_admin_org" on missed_checkins
  for select to authenticated using (is_org_admin(organization_id));

drop policy if exists "missed_checkins_select_own" on missed_checkins;
create policy "missed_checkins_select_own" on missed_checkins
  for select to authenticated using (student_id = auth.uid());

-- Configs por academia. Limite 0 = regra de bloqueio desligada (default: ligar é
-- decisão explícita do dono). Valor 0 = cai no repasse do parceiro
-- (partner_checkin_rates.value).
insert into system_settings (organization_id, key, value)
select id, 'missed_checkin_block_limit', '0' from organizations
on conflict (organization_id, key) do nothing;

insert into system_settings (organization_id, key, value)
select id, 'missed_checkin_price', '0' from organizations
on conflict (organization_id, key) do nothing;
