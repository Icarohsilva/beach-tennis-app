-- Aula Experimental por Região — campos de vitrine pública na organização.
-- Idempotente (add column if not exists), padrão do projeto. Sem backfill obrigatório:
-- is_listed = true por default (opt-in ligado), mas a org só aparece no diretório
-- quando city estiver preenchida (ver índice e regra de listagem na app).

alter table organizations add column if not exists is_listed     boolean not null default true;
alter table organizations add column if not exists state         text;
alter table organizations add column if not exists city          text;
alter table organizations add column if not exists neighborhood  text;
alter table organizations add column if not exists address_line  text;
alter table organizations add column if not exists sports        text[] not null default '{}';
alter table organizations add column if not exists whatsapp      text;

-- Índice parcial para o diretório público (filtra status/is_listed e ordena por cidade).
create index if not exists organizations_directory_idx
  on organizations (city)
  where status = 'active' and is_listed;
