-- supabase/migrations/20260721000000_class_sessions_created_at.sql
-- Adiciona created_at para exibir "gerada em/há X" por turma (spec 2026-07-21 §4).
-- Linhas existentes recebem now() no deploy (a data de geração passada se perde —
-- aceitável, sem risco destrutivo).
alter table class_sessions
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_class_sessions_class_created on class_sessions (class_id, created_at desc);
