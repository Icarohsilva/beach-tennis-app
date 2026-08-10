-- Cadastro inativo por academia (exclusão lógica do aluno).
--
-- A academia precisa tirar um aluno da operação — tipicamente um dependente que
-- saiu — sem apagar nada: presença (`attendance`), extrato de crédito
-- (`credit_transactions`) e pontuação da Liga (`liga_points`) referenciam o
-- profile, e o histórico do que já aconteceu não deve mudar porque a pessoa saiu.
--
-- Por que uma coluna nova em vez de reusar `contract_active`: aquela coluna
-- significa "assinatura ativa" e é exibida como "(inativo)" ao lado do plano.
-- Misturar as duas faria um mensalista em atraso aparecer como aluno excluído — e,
-- pior, faria reativar a assinatura ressuscitar o cadastro.
--
-- `timestamptz` em vez de boolean: registra QUANDO saiu (a academia pergunta isso),
-- é aditiva (null = ativo, então nenhuma linha existente precisa de backfill) e
-- `archived_at is null` é o filtro natural em toda leitura.
alter table memberships add column if not exists archived_at timestamptz;

comment on column memberships.archived_at is
  'Quando o vínculo foi inativado nesta academia. null = ativo. Exclusão lógica: '
  'o histórico (presença, crédito, Liga) continua intacto e apontando para o profile.';

-- Índice parcial: toda listagem de aluno filtra `archived_at is null`, e o índice
-- parcial cobre exatamente esse caminho sem inflar com as linhas inativas (que são
-- a minoria e só aparecem na tela de reativação).
create index if not exists memberships_org_active_students_idx
  on memberships (organization_id, role)
  where archived_at is null;
