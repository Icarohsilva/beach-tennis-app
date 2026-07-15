-- supabase/migrations/20260714000100_user_emails_view.sql

-- View somente-leitura para o dispatch de notificacoes (Frente 1) resolver
-- e-mail de alunos em lote. profiles/memberships nao tem coluna de e-mail —
-- ele vive em auth.users. Só o service role recebe grant (nunca anon nem
-- authenticated), entao nao vaza e-mail via API publica/RLS.
create or replace view public.user_emails as
  select id, email from auth.users;

revoke all on public.user_emails from anon, authenticated;
grant select on public.user_emails to service_role;
