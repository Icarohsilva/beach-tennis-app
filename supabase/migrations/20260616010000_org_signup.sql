-- Plano 2 — cadastro self-service de academia + entrada de alunos
-- Adiciona dono (owner_id) e descrição às organizations. O dono é o admin master:
-- pode gerir financeiro/configurações/equipe. Professores são admins SEM owner_id match.

alter table organizations add column if not exists owner_id uuid references profiles(id);
alter table organizations add column if not exists description text;

-- Backfill: define o dono da(s) academia(s) existente(s) como o admin mais antigo dela.
-- Idempotente: só preenche quando ainda está nulo.
update organizations o
set owner_id = (
  select p.id from profiles p
  where p.organization_id = o.id and p.role = 'admin'
  order by p.created_at asc
  limit 1
)
where o.owner_id is null;
