-- Flags de "tour guiado visto" por pessoa (profiles = identidade compartilhada).
-- Fonte de verdade cross-device: o tour não repete se o usuário troca de aparelho.
alter table public.profiles
  add column if not exists tour_aluno_seen_at timestamptz,
  add column if not exists tour_admin_seen_at timestamptz;
