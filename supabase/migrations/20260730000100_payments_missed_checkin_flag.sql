-- Marca o payments que nasceu de uma pendência de CHECK-IN, distinguindo-o da
-- pendência de aula avulsa (spec 2026-07-30-controle-wellhub-pendencias §1).
--
-- Por que a flag existe: a pendência de check-in com valor > 0 cria um payments
-- para reusar de graça PIX+comprovante, Mercado Pago e a baixa manual. Sem a flag
-- ela também cairia no bloqueio por carência de dias (debt_block_grace_days,
-- lib/utils/debtRules.ts) — DOIS bloqueios para a mesma falta, um deles por uma
-- regra que o dono da academia não configurou. Com a flag, bookSession e
-- getOrgDebtors filtram missed_checkin = false: a dívida de avulsa segue governada
-- pela carência, e a pendência de check-in só pelo limite de contagem.

alter table payments add column if not exists missed_checkin boolean not null default false;

create index if not exists payments_missed_checkin_idx
  on payments (organization_id, missed_checkin) where missed_checkin = true;

-- Sincroniza a baixa do payments de volta para a pendência de check-in.
--
-- É trigger, e não uma chamada nos callers, porque a baixa acontece em quatro
-- lugares independentes (webhook do Mercado Pago, approveDebtReceipt, markDebtPaid,
-- markAllDebtsPaid) e esquecer um deles deixaria o aluno bloqueado depois de pagar.
create or replace function sync_missed_checkin_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and coalesce(old.status::text, '') <> 'paid' then
    update missed_checkins
       set status = 'paid', resolved_at = now()
     where payment_id = new.id and status = 'open';
  end if;
  return new;
end $$;

drop trigger if exists payments_sync_missed_checkin on payments;
create trigger payments_sync_missed_checkin
  after update of status on payments
  for each row execute function sync_missed_checkin_paid();
