-- Gênero é identidade (não por-academia), então mora em profiles (slim pós-cutover).
-- Coletado no cadastro/criação de aluno, editável no /perfil. Alunos existentes
-- ficam null até preencher. Usado pela elegibilidade de torneios M/F.
alter table profiles add column if not exists gender text;

alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add constraint profiles_gender_check
  check (gender in ('M', 'F') or gender is null);
