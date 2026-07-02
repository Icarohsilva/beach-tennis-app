-- Painel Super-Admin: flag de identidade GLOBAL de dono-da-plataforma.
-- Mora em profiles (1 por pessoa), não em memberships (por-academia). Não mexe
-- no enum user_role nem na RLS existente. Só é setada por SQL (service role).
alter table profiles
  add column if not exists is_platform_admin boolean not null default false;
