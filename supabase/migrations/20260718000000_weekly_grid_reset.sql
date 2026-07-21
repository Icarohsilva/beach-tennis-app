-- supabase/migrations/20260718000000_weekly_grid_reset.sql
-- Virada do regime de 90 dias para geração semanal (spec 2026-07-17).
-- Zera as sessões futuras que o regime velho deixou, para a geração semanal
-- assumir. Preserva o que já foi realizado.

-- Apaga class_sessions de HOJE (BRT) em diante, EXCETO:
--   - status = 'completed' (aula já finalizada),
--   - sessões com presença marcada (attendance),
--   - sessões com reserva avulsa confirmada paga em crédito (session_bookings
--     credit_used=true, status='confirmed') — o DELETE é bruto e não passa
--     pelo cancelBooking, que sempre estorna o crédito ao remover uma reserva;
--     sem esta exceção o aluno perderia crédito e reserva sem estorno nem aviso, e
--   - sessões com lista de espera ativa (waitlists status in ('waiting','offered'))
--     — perder a sessão junto com a espera não pode ser recuperado depois, pois
--     a próxima geração cria uma sessão nova (UUID novo), sem a entrada de espera.
-- porque desde o spec de acesso/crédito (2026-07-16) a dívida e o financeiro
-- nascem da presença — apagar isso destruiria registro financeiro.
--
-- Cascade (001_initial_schema.sql): session_bookings, attendance e waitlists são
-- 'on delete cascade' (as reservas/esperas futuras caem junto; attendance só
-- existe nas preservadas). payments.session_id é 'on delete set null' — uma
-- pré-declaração de admin (paid) numa sessão futura sem presença vira um
-- pagamento órfão com session_id null; é inofensivo (hasOpenDebt filtra
-- session_id not null).
delete from class_sessions cs
where cs.session_date >= (now() at time zone 'America/Sao_Paulo')::date
  and cs.status <> 'completed'
  and not exists (
    select 1 from attendance a where a.session_id = cs.id
  )
  and not exists (
    select 1 from session_bookings sb
    where sb.session_id = cs.id and sb.credit_used = true and sb.status = 'confirmed'
  )
  and not exists (
    select 1 from waitlists w
    where w.session_id = cs.id and w.status in ('waiting', 'offered')
  );
