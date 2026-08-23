-- supabase/migrations/20260824000000_waitlist_first_notified.sql
--
-- Entrada automática pela fila de espera: quando uma vaga abre, o primeiro da
-- fila entra sozinho e o segundo é avisado de que virou primeiro.
--
-- Esta coluna é o que torna esse segundo aviso IDEMPOTENTE. Sem ela, toda
-- passada que reavaliasse a sessão (o cron de rede de segurança, um segundo
-- cancelamento na mesma aula) avisaria de novo quem já é o primeiro da fila.
--
-- Não reaproveitei `notified_at`: hoje ela significa "a fila inteira foi avisada
-- de que abriu vaga", conceito que deixa de existir, e linhas antigas já vêm
-- preenchidas. Repurposar suprimiria em silêncio o aviso de quem já estivesse
-- numa fila no momento do deploy. `notified_at` fica onde está (o painel do
-- professor a lê) e só para de ser escrita.
alter table waitlists
  add column if not exists first_notified_at timestamptz;

comment on column waitlists.first_notified_at is
  'Quando o aluno foi avisado de que virou o PRIMEIRO da fila. Null = ainda não avisado. Garante que o aviso saia uma vez só.';
