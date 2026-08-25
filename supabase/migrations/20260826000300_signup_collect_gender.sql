-- Cadastro coleta gênero, quando informado.
--
-- O QUE MUDA: profiles.gender passa a ser gravado no cadastro, a partir de
-- new.raw_user_meta_data->>'gender'.
--
-- Por que agora: a regra de composição de dupla de torneio (allowed_pair_genders,
-- 20260826000100) só funciona para quem TEM gênero no perfil — e até aqui gênero
-- só era coletado em /perfil, nunca no cadastro. Resultado: quase todo atleta
-- tinha gender null e qualquer torneio com restrição de gênero barrava geral com
-- "complete seu gênero no perfil", inclusive quem acabou de se cadastrar para
-- jogar aquele torneio. Cadastro opcional aqui, sem check novo: perfis sem
-- gênero continuam válidos (torneio livre não pede nada), e o app pergunta de
-- novo na hora da inscrição quando a categoria exige.
--
-- Entrada só aceita 'M'/'F' — qualquer outro valor (string vazia, lixo) vira
-- null, nunca erro: um metadata malformado não pode derrubar o cadastro.
--
-- Base: 20260810000200_signup_without_org.sql (definição vigente). A ÚNICA
-- mudança é a linha de gender no insert de profiles; o resto vai idêntico para
-- o `create or replace` não perder comportamento.
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
  v_gender     text := case when new.raw_user_meta_data->>'gender' in ('M','F') then new.raw_user_meta_data->>'gender' else null end;
begin
  -- Convite ausente ou inválido deixa v_org nulo — e é isso mesmo. Sem academia
  -- padrão para cair dentro.
  select id, sports into v_org, v_org_sports
    from organizations
    where invite_code = v_invite and status = 'active';

  -- profiles agora é só identidade.
  insert into public.profiles (id, full_name, avatar_url, phone, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    v_gender
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
  -- Sem convite não há membership nenhuma: a pessoa entra como visitante e se
  -- vincula depois, ao entrar num torneio ou usar um código.
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
