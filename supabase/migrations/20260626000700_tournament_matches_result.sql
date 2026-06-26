-- Resultado por games + fluxo de confirmação. winner_id (existente) vira derivado/opcional.
alter table tournament_matches add column if not exists match_no int;
alter table tournament_matches add column if not exists result jsonb;
alter table tournament_matches add column if not exists games1 int;
alter table tournament_matches add column if not exists games2 int;
alter table tournament_matches add column if not exists result_status text;
alter table tournament_matches add column if not exists reported_by uuid references profiles(id);
alter table tournament_matches add column if not exists confirmed_by uuid references profiles(id);

alter table tournament_matches drop constraint if exists tmatches_result_status_check;
alter table tournament_matches add constraint tmatches_result_status_check
  check (result_status in ('pending', 'confirmed') or result_status is null);
