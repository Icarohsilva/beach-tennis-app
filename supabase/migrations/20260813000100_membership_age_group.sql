-- Aluno adulto ou kids, por academia.
--
-- A turma já se declara `kids` ou `adult` (`classes.type`), mas o aluno não: a
-- academia sabia de cabeça quem era criança, e quem monta a grade não tinha como
-- conferir. Sem isso não dá para avisar "esse é kids e a turma é de adulto", nem
-- para separar as duas operações na lista de alunos, que na prática são duas
-- rotinas diferentes (horário, professor, cobrança do responsável).
--
-- Fica na membership, não em profiles, porque é uma leitura DA ACADEMIA sobre o
-- aluno: a mesma pessoa pode ser kids na escolinha e adulto em outra arena, e o
-- corte de idade é escolha de cada uma. Mesma razão de `level` e `sports` viverem
-- aqui.
--
-- Default 'adult' porque é o que a base inteira é hoje: nenhuma linha existente
-- precisa de backfill, e o admin marca kids conforme for cadastrando.
--
-- Nome `age_group` e não `student_type` para não colidir com `setStudentType()`
-- (features/checkin/actions.ts), que já significa outra coisa: o eixo de cobrança
-- e parceiro do aluno. Duas coisas com o mesmo nome viram bug de leitura.
alter table memberships
  add column if not exists age_group text not null default 'adult';

alter table memberships drop constraint if exists memberships_age_group_check;
alter table memberships add constraint memberships_age_group_check
  check (age_group in ('adult', 'kids'));

comment on column memberships.age_group is
  'Aluno adulto ou kids NESTA academia. Espelha classes.type; usado para avisar '
  'incompatibilidade de turma e para filtrar a lista de alunos. Nunca bloqueia.';

-- Índice parcial só para kids: eles são a minoria, e o filtro que a tela faz é
-- "mostre só os kids" — o caminho contrário (adultos) já é servido pelo índice de
-- alunos ativos, porque é quase a lista inteira.
create index if not exists memberships_org_kids_idx
  on memberships (organization_id)
  where age_group = 'kids' and archived_at is null;
