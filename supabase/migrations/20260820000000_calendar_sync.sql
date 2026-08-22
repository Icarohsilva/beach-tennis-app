-- Assinatura de agenda externa (.ics) por aluno.
--
-- O aluno cola um link pessoal no Google/Outlook/Apple Calendar uma única vez
-- ("assinar por URL"); dali em diante toda aula nova, cancelamento ou
-- remarcação aparece sozinha, porque o app de calendário dele busca esse link
-- de novo periodicamente. Não é OAuth: não guardamos credencial de nenhum
-- provedor, só um token nosso que identifica a membership.
--
-- Por que por membership e não por profile: toda regra de aluno já vive por
-- academia (memberships), e um aluno de duas academias precisa de dois links
-- — cada um mostrando só a agenda daquela academia.

alter table memberships add column if not exists calendar_sync_enabled boolean not null default false;

-- Gerado só quando o aluno ativa pela primeira vez (features/perfil/calendarSyncActions.ts),
-- não em todo cadastro — evita segredo para quem nunca vai usar. `unique` já dá
-- o índice que a rota pública (app/api/calendar/[token]/route.ts) usa para
-- achar a membership pelo token.
alter table memberships add column if not exists calendar_feed_token text unique;

comment on column memberships.calendar_sync_enabled is
  'Aluno ativou a assinatura de agenda externa. Desligar invalida o link na hora, sem apagar o token.';
comment on column memberships.calendar_feed_token is
  'Segredo (crypto.randomBytes) que autentica app/api/calendar/[token]. Nulo até o aluno ativar pela primeira vez.';
