-- Cadastro sem academia: conta existe antes do vínculo.
--
-- O QUE MUDA: some o fallback `select id from organizations where is_default`.
--
-- Antes, quem se cadastrava sem um `org_invite_code` válido caía dentro da
-- academia padrão — que em produção é uma academia REAL, de um cliente. Ou
-- seja: estranho que entrava por um link de torneio sem convite virava aluno
-- dele, aparecia na lista de alunos e contava no painel. Não era só ausência de
-- funcionalidade; era vazamento de gente entre academias.
--
-- Agora, sem convite válido a pessoa fica com perfil e ZERO memberships. Isso é
-- estado suportado: resolveActiveOrg (lib/org/activeOrg.ts) já devolve
-- `status: 'none'` e o layout do aluno já segue em frente com org nula.
--
-- O vínculo passa a ser CONSEQUÊNCIA, não pré-requisito:
--   - link de convite da academia  → membership 'student' (aqui e em joinAcademy)
--   - inscrição em torneio         → membership 'athlete' (registerExternal)
--   - reserva de day use           → membership 'athlete' (bookDayUseExternal)
--
-- Base: 20260802000000_sports_membership_and_class.sql (definição vigente). A
-- ÚNICA mudança é a remoção do bloco de fallback; o resto vai idêntico para o
-- `create or replace` não perder comportamento.
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
  -- Convite ausente ou inválido deixa v_org nulo — e é isso mesmo. Sem academia
  -- padrão para cair dentro.
  select id, sports into v_org, v_org_sports
    from organizations
    where invite_code = v_invite and status = 'active';

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
