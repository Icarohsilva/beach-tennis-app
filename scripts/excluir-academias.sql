-- scripts/excluir-academias.sql
--
-- Exclui academias (organizations) e os usuários que só existiam nelas.
-- Feito para o SQL Editor do Supabase. IRREVERSÍVEL depois do commit.
--
-- ┌─ POR QUE ESTE SCRIPT É EM PASSOS ────────────────────────────────────────┐
-- │ 1. Um `delete from organizations` pode FALHAR. A migração                │
-- │    20260616000000 cria `profiles.organization_id references             │
-- │    organizations(id)` SEM cascade, e a 20260616000100 repete o padrão   │
-- │    para 26 tabelas. Parte foi redefinida depois com cascade, mas o       │
-- │    próprio arquivo admite drift ("em produção existem, em CI podem não   │
-- │    existir"). O banco vivo é a verdade — o PASSO 0 pergunta a ele.       │
-- │ 2. NOME NÃO IDENTIFICA ACADEMIA. Existem cinco "Arena FAQ Demo"          │
-- │    diferentes. Apagar por ILIKE '%teste%' levaria junto uma academia     │
-- │    real chamada "Teste". Por isso a seleção é por UUID conferido.        │
-- │ 3. O app é MULTI-VÍNCULO: um aluno pode estar numa academia de teste E   │
-- │    numa real. Apagar esse usuário destruiria histórico de produção.      │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- ROTEIRO: rode 0 → 1, confira. Cole os UUID no 2. Rode 3 e LEIA a lista de
-- usuários preservados. Rode 4. Rode 5 e confira o SELECT final antes do commit.


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 0 — O que um delete de academia arrasta junto
-- ═══════════════════════════════════════════════════════════════════════════
-- Leitura pura. Toda FK que aponta para organizations e a regra de cada uma.
-- Se aparecer alguma linha com "BLOQUEIA", o PASSO 5 já trata — mas vale olhar
-- para saber onde os dados vão parar.

select
  con.conrelid::regclass::text as tabela,
  att.attname                  as coluna,
  case con.confdeltype
    when 'c' then 'CASCADE — a linha some junto com a academia'
    when 'n' then 'SET NULL — a linha fica, a coluna zera'
    when 'd' then 'SET DEFAULT — a linha fica, a coluna volta ao padrão'
    when 'a' then 'NO ACTION — BLOQUEIA o delete (tratado no passo 5)'
    when 'r' then 'RESTRICT — BLOQUEIA o delete (tratado no passo 5)'
  end                          as regra,
  att.attnotnull               as coluna_nao_aceita_null
from pg_constraint con
join pg_attribute att
  on att.attrelid = con.conrelid
 and att.attnum = con.conkey[1]
where con.contype = 'f'
  and con.confrelid = 'public.organizations'::regclass
order by con.confdeltype, 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 1 — Candidatas
-- ═══════════════════════════════════════════════════════════════════════════
-- Lista TODAS as academias, não só as que parecem teste. Esconder linha aqui é
-- o que faria alguém apagar às cegas. `parece_teste` só ordena, não filtra.
--
-- Olhe pagamentos, presencas e sessoes: são as colunas que separam academia de
-- teste de academia com vida. Qualquer número > 0 pede investigação.

select
  o.id,
  o.name                                        as academia,
  coalesce(o.city, '?') || '/' || coalesce(o.state, '?') as local,
  o.status,
  o.created_at::date                            as criada_em,
  dono.full_name                                as dono,
  (o.name ~* '(demo|teste|test)')               as parece_teste,
  ps.status                                     as plano_plataforma,
  (select count(*) from memberships  m where m.organization_id = o.id)                        as vinculos,
  (select count(*) from memberships  m where m.organization_id = o.id and m.role = 'student') as alunos,
  (select count(*) from classes      c where c.organization_id = o.id)                        as turmas,
  (select count(*) from class_sessions s where s.organization_id = o.id)                      as sessoes,
  (select count(*) from attendance   a where a.organization_id = o.id)                        as presencas,
  (select count(*) from payments     p where p.organization_id = o.id)                        as pagamentos,
  (select count(*) from tournaments  t where t.organization_id = o.id)                        as torneios
from organizations o
left join profiles dono on dono.id = o.owner_id
left join platform_subscriptions ps on ps.organization_id = o.id
order by parece_teste desc, o.created_at;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 2 — A lista
-- ═══════════════════════════════════════════════════════════════════════════
-- Cole aqui os UUID da coluna `id` do PASSO 1. Um por linha.
-- A temp table morre com a sessão; se o SQL Editor reconectar, refaça o passo.

create temporary table if not exists orgs_para_excluir (id uuid primary key);
truncate orgs_para_excluir;

insert into orgs_para_excluir (id) values
  ('00000000-0000-0000-0000-000000000000'),  -- ← troque
  ('00000000-0000-0000-0000-000000000000')   -- ← troque (e acrescente linhas)
;

-- Confere que os ids existem mesmo. Se vier menos linha do que você colou,
-- algum UUID está errado — PARE.
select o.id, o.name, o.status
from organizations o
join orgs_para_excluir x on x.id = o.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 3 — Prévia (não apaga nada)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. O que some, por academia.
select
  o.name as academia,
  (select count(*) from memberships     m where m.organization_id = o.id) as vinculos,
  (select count(*) from classes         c where c.organization_id = o.id) as turmas,
  (select count(*) from class_sessions  s where s.organization_id = o.id) as sessoes,
  (select count(*) from attendance      a where a.organization_id = o.id) as presencas,
  (select count(*) from payments        p where p.organization_id = o.id) as pagamentos,
  (select count(*) from tournaments     t where t.organization_id = o.id) as torneios
from organizations o
join orgs_para_excluir x on x.id = o.id
order by o.name;

-- 3b. USUÁRIOS QUE SERÃO APAGADOS.
-- Só quem não tem vínculo em nenhuma academia fora da lista. Inclui dependentes
-- (profiles sem linha em auth.users — gerenciados pelo responsável).
select
  p.id,
  p.full_name,
  au.email,
  (au.id is null) as e_dependente_sem_login
from profiles p
left join auth.users au on au.id = p.id
where p.is_platform_admin is not true                      -- nunca o super admin
  and exists (
    select 1 from memberships m
    where m.user_id = p.id and m.organization_id in (select id from orgs_para_excluir)
  )
  and not exists (
    select 1 from memberships m2
    where m2.user_id = p.id and m2.organization_id not in (select id from orgs_para_excluir)
  )
order by p.full_name;

-- 3c. ⚠️ USUÁRIOS PRESERVADOS — LEIA ESTA LISTA.
-- Estão numa academia da lista MAS também em outra. Não serão apagados; só
-- perdem o vínculo com a academia excluída. Se aparecer alguém aqui que você
-- esperava apagar, é porque ele participa de uma academia real.
select
  p.full_name,
  au.email,
  string_agg(distinct o2.name, ', ') as continua_em
from profiles p
left join auth.users au on au.id = p.id
join memberships m  on m.user_id = p.id and m.organization_id in (select id from orgs_para_excluir)
join memberships m2 on m2.user_id = p.id and m2.organization_id not in (select id from orgs_para_excluir)
join organizations o2 on o2.id = m2.organization_id
group by p.full_name, au.email
order by p.full_name;

-- 3d. Arquivos em storage. O SQL NÃO apaga o arquivo em si — só a linha de
-- metadados. Se a lista vier vazia, não há nada a fazer. Se vier com linhas,
-- apague pelo painel (Storage → bucket → caminho) depois do PASSO 5.
select o.bucket_id, o.name as caminho
from storage.objects o
where o.bucket_id in ('org-logos', 'tournament-photos', 'tournament-images')
  and exists (
    select 1 from orgs_para_excluir x
    where o.name like x.id::text || '%'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 4 — Trava
-- ═══════════════════════════════════════════════════════════════════════════
-- Aborta se alguma academia selecionada tiver sinal de vida. Existe porque a
-- prévia depende de alguém ler com atenção, e isso falha às 23h.
-- Se você TEM certeza e quer apagar mesmo assim, comente o raise.

do $$
declare
  suspeitas text;
begin
  select string_agg(format('%s (pagamentos=%s, presencas=%s, plano=%s)',
                           o.name, pag.n, pres.n, coalesce(ps.status, '—')), e'\n')
    into suspeitas
  from organizations o
  join orgs_para_excluir x on x.id = o.id
  cross join lateral (select count(*) n from payments   p where p.organization_id = o.id) pag
  cross join lateral (select count(*) n from attendance a where a.organization_id = o.id) pres
  left join platform_subscriptions ps on ps.organization_id = o.id
  where pag.n > 0
     or pres.n > 0
     or ps.status = 'active';

  if suspeitas is not null then
    raise exception e'ABORTADO: academia com sinal de vida na lista:\n%', suspeitas;
  end if;

  raise notice 'Trava OK: nenhuma academia da lista tem pagamento, presença ou plano ativo.';
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 5 — Exclusão (dentro de transação)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nada é definitivo até o COMMIT no fim. `rollback` desfaz tudo.

begin;

-- 5.1 Congela quem vai ser apagado ANTES de mexer em memberships — a membership
-- some junto com a academia e levaria essa informação embora.
create temporary table if not exists usuarios_condenados (id uuid primary key);
truncate usuarios_condenados;

insert into usuarios_condenados (id)
select p.id
from profiles p
where p.is_platform_admin is not true
  and exists (
    select 1 from memberships m
    where m.user_id = p.id and m.organization_id in (select id from orgs_para_excluir)
  )
  and not exists (
    select 1 from memberships m2
    where m2.user_id = p.id and m2.organization_id not in (select id from orgs_para_excluir)
  );

-- 5.2 Solta as FKs que BLOQUEARIAM o delete (as que o PASSO 0 marcou NO ACTION
-- ou RESTRICT). Percorre pg_constraint em vez de eu listar tabelas na mão —
-- assim funciona mesmo com o drift do schema.
--   • coluna aceita null  → zera a coluna (é o caso de profiles.organization_id)
--   • coluna é NOT NULL   → apaga a linha (não há como desamarrar)
do $$
declare
  r record;
  n bigint;
begin
  for r in
    select con.conrelid::regclass::text as tabela,
           att.attname                  as coluna,
           att.attnotnull               as nao_aceita_null
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.organizations'::regclass
      and con.confdeltype in ('a', 'r')      -- só as que bloqueiam
  loop
    if r.nao_aceita_null then
      execute format(
        'delete from %s where %I in (select id from orgs_para_excluir)',
        r.tabela, r.coluna);
      get diagnostics n = row_count;
      raise notice 'apagou % linha(s) de % (coluna NOT NULL)', n, r.tabela;
    else
      execute format(
        'update %s set %I = null where %I in (select id from orgs_para_excluir)',
        r.tabela, r.coluna, r.coluna);
      get diagnostics n = row_count;
      raise notice 'zerou % em % linha(s) de %', r.coluna, n, r.tabela;
    end if;
  end loop;
end $$;

-- 5.3 As academias. As FKs com CASCADE levam junto turmas, sessões, presenças,
-- memberships, créditos, Liga, torneios etc.
delete from organizations where id in (select id from orgs_para_excluir);

-- 5.4 Os usuários. Duas passadas porque dependente NÃO tem linha em auth.users
-- (é profile gerenciado pelo responsável, sem login).
delete from auth.users where id in (select id from usuarios_condenados);
delete from profiles   where id in (select id from usuarios_condenados);

-- 5.5 Metadados dos arquivos. O arquivo em si continua no bucket — veja 3d.
delete from storage.objects o
where o.bucket_id in ('org-logos', 'tournament-photos', 'tournament-images')
  and exists (
    select 1 from orgs_para_excluir x
    where o.name like x.id::text || '%'
  );

-- 5.6 Conferência. `academias_restantes` e `usuarios_restantes` têm que ser 0.
select
  (select count(*) from organizations o join orgs_para_excluir x on x.id = o.id) as academias_restantes,
  (select count(*) from profiles p join usuarios_condenados u on u.id = p.id)    as usuarios_restantes,
  (select count(*) from organizations)                                           as total_de_academias_agora;


-- ═══════════════════════════════════════════════════════════════════════════
-- DECIDA
-- ═══════════════════════════════════════════════════════════════════════════
-- Conferiu o 5.6? Então descomente UMA linha e execute:

-- commit;     -- confirma. NÃO TEM VOLTA.
-- rollback;   -- desfaz tudo, como se nada tivesse acontecido.
