-- supabase/migrations/20260826000400_tournament_entry_partner_payment.sql
-- A dupla são DUAS inscrições pagas numa linha só.
--
-- Hoje computePaymentFields roda para player_id e ninguém mais: em torneio de
-- R$60 por atleta a dupla paga R$60 no total. O parceiro entra de graça.
--
-- Colunas partner_* na MESMA linha, e não uma linha-sombra: tournament_entries
-- é "uma linha por unidade inscrita" (20260626000600), e toda a leitura do
-- módulo conta linha como competidor — capacidade (availableSlots), sorteio
-- (splitBySeed), classificação e pódio. Uma linha extra por parceiro dobraria
-- o torneio.
--
-- E não um valor único da dupla: o desconto é POR PESSOA (2º/3º torneio da
-- semana daquela pessoa), o comprovante é por pessoa e a confirmação do PIX é
-- por pessoa. Somado num número só, o admin perde a única resposta que
-- importa: quem ainda deve.
alter table tournament_entries
  add column if not exists partner_payment_status text
    check (partner_payment_status is null or partner_payment_status in ('free', 'pending', 'paid')),
  add column if not exists partner_discount_pct numeric(5,2) not null default 0,
  add column if not exists partner_final_price_cents integer not null default 0,
  add column if not exists partner_receipt_url text;

-- Nulo (não 'free') nas linhas antigas e em toda inscrição sem parceiro: 'free'
-- afirmaria "este parceiro não devia nada", e o que se sabe das linhas de antes
-- desta migração é que ninguém cobrou — não que fosse de graça.
comment on column tournament_entries.partner_payment_status is
  'Cobrança do parceiro. Nulo = não há parceiro, ou linha anterior à cobrança em dupla (nunca foi cobrada).';

create index if not exists tournament_entries_partner_pending_idx
  on tournament_entries (tournament_id)
  where partner_payment_status = 'pending';
