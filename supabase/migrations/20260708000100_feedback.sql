-- supabase/migrations/20260708000100_feedback.sql

-- Canal de feedback do usuário (bug / elogio / ideia). Lido só pelo dono da
-- plataforma (profiles.is_platform_admin). organization_id é só contexto.
create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  category        text not null check (category in ('bug','elogio','ideia')),
  message         text not null,
  image_path      text,
  status          text not null default 'novo' check (status in ('novo','lido','resolvido')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_feedback_created on feedback(created_at desc);

alter table feedback enable row level security;

-- Usuário insere a própria linha.
drop policy if exists "feedback_insert_own" on feedback;
create policy "feedback_insert_own" on feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- Só platform admin lê.
drop policy if exists "feedback_select_platform_admin" on feedback;
create policy "feedback_select_platform_admin" on feedback
  for select to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- Só platform admin altera status.
drop policy if exists "feedback_update_platform_admin" on feedback;
create policy "feedback_update_platform_admin" on feedback
  for update to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- Bucket privado para imagens de feedback. Path: {user_id}/{uuid}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images',
  'feedback-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Usuário só faz upload no próprio path ({user_id}/...).
drop policy if exists "feedback_img_upload_own" on storage.objects;
create policy "feedback_img_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura das imagens pelo painel é via service role (createAdminClient), sem policy extra.
