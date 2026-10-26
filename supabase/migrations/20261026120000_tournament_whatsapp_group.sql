-- supabase/migrations/20261026120000_tournament_whatsapp_group.sql
-- Link de convite do grupo do WhatsApp do torneio (chat.whatsapp.com/...).
-- O inscrito vê "Entrar no grupo" na página do torneio e entra sozinho: o
-- WhatsApp só deixa a arena adicionar quem está salvo nos contatos dela.
-- Normalizado em lib/torneios/whatsappGroup.ts antes de gravar.
alter table public.tournaments
  add column if not exists whatsapp_group_url text;

comment on column public.tournaments.whatsapp_group_url is
  'Convite do grupo do WhatsApp do torneio. Só aparece para quem está inscrito.';
