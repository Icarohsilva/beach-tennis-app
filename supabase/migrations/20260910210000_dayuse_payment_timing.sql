-- supabase/migrations/20260910210000_dayuse_payment_timing.sql
-- QUANDO o day use é pago: na inscrição ou na arena. Escolha da academia,
-- por horário.
--
-- Até aqui o app DEDUZIA isso da configuração: com Mercado Pago ou chave PIX,
-- cobrava na inscrição; sem nenhum dos dois, tratava como pago na arena. Deduzir
-- erra nas duas direções — a arena que tem PIX cadastrado mas cobra na porta
-- ficava com o aluno preso num pagamento que ela não queria, e a que quer
-- receber antes não tinha como exigir.
--
-- 'on_booking' = paga ao reservar (Checkout Pro, PIX na chave da arena, crédito)
-- 'on_site'    = reserva confirma na hora e o dinheiro é acertado na quadra
alter table dayuse_slots
  add column if not exists payment_timing text not null default 'on_site';
alter table dayuse_recurrences
  add column if not exists payment_timing text not null default 'on_site';

alter table dayuse_slots drop constraint if exists dayuse_slots_payment_timing_check;
alter table dayuse_slots add constraint dayuse_slots_payment_timing_check
  check (payment_timing in ('on_booking', 'on_site'));

alter table dayuse_recurrences drop constraint if exists dayuse_recurrences_payment_timing_check;
alter table dayuse_recurrences add constraint dayuse_recurrences_payment_timing_check
  check (payment_timing in ('on_booking', 'on_site'));

comment on column dayuse_slots.payment_timing is
  'on_booking = paga ao reservar (checkout, PIX da arena, crédito); on_site = acerta na quadra. Escolha do admin, não dedução da configuração.';

-- Backfill que PRESERVA o comportamento de hoje: academia que já podia cobrar
-- online continua cobrando na inscrição. O resto fica 'on_site', que é o que o
-- app fazia de fato.
--
-- As três condições são as MESMAS de `getDayUsePricing.canCharge`: venda de day
-- use ligada E (gateway conectado OU chave PIX). A venda desligada entra na
-- conta de propósito — marcar 'on_booking' numa academia que não vende day use
-- não mudaria nada na cobrança (o efetivo cai para 'on_site' de qualquer jeito)
-- e faria a tela do admin acusar "falta configurar pagamento" apontando para o
-- lugar errado.
update dayuse_slots s
   set payment_timing = 'on_booking'
 where s.payment_timing = 'on_site'
   and exists (
     select 1 from system_settings ss
      where ss.organization_id = s.organization_id
        and ss.key = 'day_use_sale_enabled'
        and ss.value = 'true'
   )
   and (
     exists (
       select 1 from org_gateway_accounts g
        where g.organization_id = s.organization_id
          and g.gateway = 'mercadopago'
          and g.status = 'connected'
     )
     or exists (
       select 1 from system_settings ss
        where ss.organization_id = s.organization_id
          and ss.key = 'pix_key'
          and coalesce(btrim(ss.value), '') <> ''
     )
   );

update dayuse_recurrences r
   set payment_timing = 'on_booking'
 where r.payment_timing = 'on_site'
   and exists (
     select 1 from system_settings ss
      where ss.organization_id = r.organization_id
        and ss.key = 'day_use_sale_enabled'
        and ss.value = 'true'
   )
   and (
     exists (
       select 1 from org_gateway_accounts g
        where g.organization_id = r.organization_id
          and g.gateway = 'mercadopago'
          and g.status = 'connected'
     )
     or exists (
       select 1 from system_settings ss
        where ss.organization_id = r.organization_id
          and ss.key = 'pix_key'
          and coalesce(btrim(ss.value), '') <> ''
     )
   );
