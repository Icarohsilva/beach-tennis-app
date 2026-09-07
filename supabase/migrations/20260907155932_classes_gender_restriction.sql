-- Restrição de sexo por turma: Livre (default/NULL) / Feminino ('F') / Masculino ('M').
-- Turma Kids ignora esta coluna — quem entra é sempre o dependente.
--
-- Sem backfill: NULL já É "livre", e toda linha existente nasce NULL — nenhuma
-- turma atual (Kids incluída) muda de comportamento com esta migração.
alter table classes add column if not exists gender_restriction text;

alter table classes add constraint classes_gender_restriction_check
  check (gender_restriction in ('M', 'F') or gender_restriction is null);

comment on column classes.gender_restriction is
  'Restrição de sexo da turma: NULL = livre (qualquer aluno). Turma Kids ignora este campo — quem entra é sempre o dependente.';
