-- Normaliza o ID do aluno no parceiro (wellhub_id / totalpass_id).
--
-- Bug: o portal da Wellhub exibe o gympass_id agrupado com espaços
-- ("3603 3181 0803 2"). Quem copia/cola grava o ID COM os espaços, mas o webhook
-- manda o unique_token limpo ("3603318108032") — o match por igualdade nunca casa
-- e TODO check-in do aluno cai na fila de pendentes. O .trim() do app não pegava
-- isso: ele só remove as pontas, não os espaços internos.
--
-- Espelha lib/checkin/partnerId.ts (normalizePartnerId): mesma lista de caracteres
-- que o \s do JS + os zero-width. Usa translate()/chr() em vez de regex de propósito:
-- [[:space:]] depende do locale do banco e não garante NBSP/zero-width, e chr() é
-- code point explícito — não depende do motor de regex nem de collation.

create or replace function public.normalize_partner_id(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(
    translate(
      coalesce(p_raw, ''),
      -- ASCII: espaço, tab, LF, VT, FF, CR
      ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) ||
      -- NBSP (o mais comum em copy/paste de web) e OGHAM SPACE
      chr(160) || chr(5760) ||
      -- EN QUAD .. HAIR SPACE (U+2000–U+200A)
      chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) ||
      chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) ||
      -- zero-width (U+200B–U+200D), LINE/PARAGRAPH SEP, NNBSP, MMSP, IDEOGRAPHIC, BOM
      chr(8203) || chr(8204) || chr(8205) ||
      chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279),
      ''
    ),
    ''
  );
$$;

-- 1. Limpa os IDs já gravados com espaço (é o que destrava os alunos cujos
--    check-ins vinham caindo em pendentes).
update memberships
set wellhub_id = normalize_partner_id(wellhub_id)
where wellhub_id is distinct from normalize_partner_id(wellhub_id);

update memberships
set totalpass_id = normalize_partner_id(totalpass_id)
where totalpass_id is distinct from normalize_partner_id(totalpass_id);

-- 2. handle_new_user: o cadastro grava o partner_id vindo do metadata do signup, e
--    fazia só nullif(v_partner_id, '') — mesmo furo dos espaços internos. Base:
--    20260624000000_profiles_identity_cutover.sql (definição vigente); a ÚNICA
--    mudança é normalize_partner_id no lugar de nullif.
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
  v_pp         checkin_partner := case when v_partner in ('wellhub','totalpass') then v_partner::checkin_partner else null end;
  v_wellhub    text := case when v_partner = 'wellhub' then normalize_partner_id(v_partner_id) else null end;
  v_totalpass  text := case when v_partner = 'totalpass' then normalize_partner_id(v_partner_id) else null end;
begin
  select id into v_org
    from organizations
    where invite_code = v_invite and status = 'active';

  if v_org is null then
    select id into v_org from organizations where is_default limit 1;
  end if;

  -- profiles agora é só identidade.
  insert into public.profiles (id, full_name, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone'
  );

  -- Campos por-academia (inclusive parceiro de check-in) vão para a membership.
  if v_org is not null then
    insert into public.memberships (
      user_id, organization_id, role, pending_partner, wellhub_id, totalpass_id
    )
    values (new.id, v_org, 'student', v_pp, v_wellhub, v_totalpass)
    on conflict (user_id, organization_id) do nothing;
  end if;

  return new;
end;
$$;
