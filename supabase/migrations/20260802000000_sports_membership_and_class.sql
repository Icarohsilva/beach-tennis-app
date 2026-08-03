-- Esportes do aluno (por academia) e modalidade da turma.
--
-- Contexto: a aba Liga precisa saber de quais rankings cada aluno participa. Hoje
-- esse dado não existe: organizations.sports diz o que a academia OFERECE e
-- tournaments.sport diz o esporte do TORNEIO, mas o aluno não tem esporte nenhum.
--
-- Modelo: esporte continua sendo um slug de lib/arenas/sports.ts (sem tabela),
-- igual ao que organizations.sports e tournaments.sport já fazem.
--   - memberships.sports: 1..N esportes que a pessoa pratica NAQUELA academia.
--   - classes.sport: a modalidade da turma (nullable = "sem modalidade").
--
-- classes.sport é INFORMATIVO. Não existe gating por modalidade em lugar nenhum:
-- aluno de beach tennis continua podendo reservar turma de futevôlei. É a mesma
-- decisão da spec 2026-07-09 (generalizar multi-modalidade), que removeu o gating
-- por nível e deixou classes.level/memberships.level dormentes.

alter table memberships add column if not exists sports text[] not null default '{}';
alter table classes     add column if not exists sport  text;

-- "quem pratica X nesta academia" (consulta base do rank da Liga).
create index if not exists memberships_org_sports_idx on memberships using gin (sports);
create index if not exists classes_org_sport_idx on classes (organization_id, sport);

-- Backfill conservador: só onde não há ambiguidade nenhuma, isto é, academias que
-- declararam EXATAMENTE uma modalidade. Academia multi-modalidade fica em branco
-- para o admin preencher — chutar aqui seria pior que o campo vazio. Idempotente:
-- só toca em linha ainda não preenchida.
update classes c
   set sport = o.sports[1]
  from organizations o
 where c.organization_id = o.id
   and c.sport is null
   and array_length(o.sports, 1) = 1;

update memberships m
   set sports = o.sports
  from organizations o
 where m.organization_id = o.id
   and m.sports = '{}'
   and array_length(o.sports, 1) = 1;

-- handle_new_user: o cadastro público (app/(auth)/cadastro) manda os esportes
-- escolhidos no metadata do signUp e o trigger grava na membership.
--
-- Por que no trigger e não numa server action pós-signup: quando a academia exige
-- confirmação de email o signUp não devolve sessão, e uma action que recebesse o
-- user_id do cliente seria IDOR (o mesmo risco que features/legal/actions.ts já
-- documenta). Aqui o new.id vem do próprio Auth.
--
-- Guarda de domínio: os slugs do metadata são interseccionados com o cardápio da
-- academia (organizations.sports) — espelha normalizeSportsForOrg em
-- lib/arenas/sports.ts. Academia sem cardápio declarado aceita os slugs como vieram
-- (mesmo fallback do TS).
--
-- Base: 20260716000000_normalize_partner_ids.sql (definição vigente); as ÚNICAS
-- mudanças são v_org_sports/v_sports e a coluna sports no insert.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner    text := new.raw_user_meta_data->>'pending_partner';
  v_partner_id text := new.raw_user_meta_data->>'partner_id';
  v_invite     text := new.raw_user_meta_data->>'org_invite_code';
  v_org        uuid;
  v_org_sports text[];
  v_sports     text[] := '{}';
  v_pp         checkin_partner := case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end;
  v_wellhub    text := case when v_partner = 'wellhub' then normalize_partner_id(v_partner_id) else null end;
  v_totalpass  text := case when v_partner = 'totalpass' then normalize_partner_id(v_partner_id) else null end;
begin
  select id, sports into v_org, v_org_sports
    from organizations
    where invite_code = v_invite and status = 'active';

  if v_org is null then
    select id, sports into v_org, v_org_sports from organizations where is_default limit 1;
  end if;

  -- profiles agora é só identidade.
  insert into public.profiles (id, full_name, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone'
  );

  -- Esportes do metadata ("slug_a,slug_b"), deduplicados e limitados ao cardápio
  -- da academia quando ela tem um.
  select coalesce(array_agg(distinct btrim(s)), '{}')
    into v_sports
    from unnest(string_to_array(coalesce(new.raw_user_meta_data->>'sports', ''), ',')) as s
   where btrim(s) <> ''
     and (
       v_org_sports is null
       or array_length(v_org_sports, 1) is null
       or btrim(s) = any(v_org_sports)
     );

  -- Campos por-academia (inclusive parceiro de check-in) vão para a membership.
  if v_org is not null then
    insert into public.memberships (
      user_id, organization_id, role, pending_partner, wellhub_id, totalpass_id, sports
    )
    values (new.id, v_org, 'student', v_pp, v_wellhub, v_totalpass, v_sports)
    on conflict (user_id, organization_id) do nothing;
  end if;

  return new;
end;
$$;
