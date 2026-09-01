# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server on localhost:3000
npm run build        # production build
npm run lint         # ESLint via next lint
npm run test         # vitest watch mode
npm run test:run     # vitest single run (CI)

# run a single test file
npm run test:run -- lib/utils/creditRules.test.ts

npm run test:responsive        # Playwright: 320/375/414px na bancada de fixtures
npm run test:responsive:rotas  # o mesmo nas rotas reais (precisa de .env.local)
```

`scripts/excluir-academias.sql` apaga academia de teste (e os usuários que só existiam
nela) pelo SQL Editor do Supabase. Seleção é por **UUID conferido na tela**, nunca por
nome — existem várias academias homônimas, e um `ILIKE '%teste%'` levaria junto uma
academia real chamada "Teste". Quem tem vínculo em outra academia é **preservado**: o app
é multi-vínculo, e apagar esse usuário destruiria histórico de produção. O passo 5.2
existe porque `profiles.organization_id` não tem `on delete cascade` — sem ele o
`delete from organizations` falha.

Rodar o passo 5 **sem confirmar é ensaio**: ele faz o trabalho, imprime o que faria e
levanta exceção, desfazendo tudo. Só aplica depois de
`update _exclusao_academias_alvo set confirmado = true`. O desenho é assim porque o SQL
Editor usa conexão de pool: temp table não sobrevive entre execuções (daí a tabela real,
derrubada no passo 6) e `begin` com `commit` comentado deixaria o editor decidir o destino
da transação — apagar achando que não apagou, ou o contrário. Pelo mesmo motivo a trava de
"academia com sinal de vida" é repetida dentro do passo 5: os passos rodam
independentemente, então uma trava que só existisse no passo 4 seria pulável.

## Plugins do Claude Code

Instalados via marketplace oficial da Anthropic (`claude plugin list` mostra `scope: user`,
valem para qualquer projeto nesta máquina — não são dependência do repo). Usar sempre que a
tarefa se encaixar, em vez de decidir de memória ou fazer scraping manual:

| Plugin | Quando usar |
|---|---|
| **context7** | Antes de responder sobre API/config de uma lib externa (Next.js, Supabase JS, date-fns, Tailwind etc.) — busca a doc atual em vez de confiar em conhecimento de treino, que pode estar desatualizado |
| **playwright** | Para validar UI de verdade num browser: rodar o dev server (`arenahub-dev` em `.claude/launch.json`) e clicar o fluxo, não só checar tipo/lint |
| **supabase** | Para inspecionar o projeto Supabase real (schema, RLS, migrations aplicadas) via MCP em vez de assumir pelo código local — **sempre usar `lib/supabase/client.ts` / `server.ts` no código da app**; o plugin é ferramenta de inspeção do Claude, não uma forma nova de acessar o banco a partir da aplicação |

Não confundir com `npx claude install <url>`: esse comando não existe. Plugin novo entra com
`claude plugin install <nome>@claude-plugins-official` (ou outro marketplace já configurado).

## Fluxo de trabalho (git)

**Antes de qualquer push, confira se o PR da branch já foi mergeado.** A branch de
trabalho é reaproveitada entre tarefas, e o PR dela costuma ser mergeado enquanto
a tarefa seguinte já está em andamento. Empilhar commit novo sobre histórico já
mergeado produz um PR que "não tem mudança nenhuma" (o GitHub já viu tudo) ou
que reabre commits antigos — nos dois casos o trabalho novo se perde de vista.

```bash
git fetch origin main
git log --oneline origin/main..HEAD   # o que ainda NÃO está na main
```

Como ler o resultado:

- **Vazio** → tudo já foi mergeado. Recomece a branch da main antes de trabalhar:
  `git checkout -B <branch> origin/main`.
- **Só os commits desta tarefa** → o PR anterior foi mergeado e o trabalho novo
  ficou de fora. Rebaseie sobre a main (`git rebase origin/main`), rode a
  validação **de novo depois do rebase** (a main pode ter andado) e faça
  `git push --force-with-lease`. O PR que sair daí é um PR **novo** — o mergeado
  não volta a receber commit.
- **Commits que você já viu no PR anterior** → aquele PR ainda está aberto; o
  push normal segue nele.

Um PR mergeado está encerrado. Nunca reutilize a numeração nem force o push por
cima do que já entrou na main.

## Architecture

**Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Supabase · Vitest · Vercel

Academy/school management app for any activity with classes and students — beach tennis, padel, crossfit, pilates, football schools, etc. (in Portuguese). Core module: class scheduling and attendance. Secondary: payments/subscriptions, social community, tournaments.

### Route Groups

| Route Group | Protection | Purpose |
|---|---|---|
| `app/(auth)/` | Public | Login, cadastro, recuperar-senha |
| `app/(dashboard)/` | Authenticated (cookie) + server-side user check | Student-facing UI with `BottomNav` |
| `app/(admin)/` | Authenticated + role=admin check | Admin panel with sidebar |
| `app/(super-admin)/` | Authenticated + `profiles.is_platform_admin` | Painel da PLATAFORMA (dona do SaaS) — ver abaixo |
| `app/experimental/` | Public | Trial class booking (no login needed) |

**Two-tier route protection:** [middleware.ts](middleware.ts) is Edge Runtime — it checks for a `sb-*-auth-token` cookie only (no Supabase import, no async). Real auth validation happens in each layout Server Component via `createClient()`. Admin role check uses `createAdminClient()` (service role key, bypasses RLS).

### Painel de Plataforma (`app/(super-admin)/`)

Gestão do SaaS em si — receita, retenção e as academias como tenants. Não confundir
com `app/(admin)/`, que é o painel de UMA academia.

| Rota | Conteúdo |
|---|---|
| `/super-admin` | Visão geral: fila de atenção, MRR/ARR/ARPA, churn e conversão de trial, aquisição, uso agregado |
| `/super-admin/academias` | Tabela de tenants com busca, filtros (assinatura, saúde, UF), ordenação e export CSV |
| `/super-admin/[id]` | Visão 360 da academia: cobrança, ativação, uso semanal, ações de ciclo de vida e auditoria |
| `/super-admin/auditoria` | Trilha de todas as ações da plataforma sobre academias |
| `/super-admin/{reembolsos,exclusoes,feedback}` | Filas operacionais (CDC, LGPD, suporte) |

- [lib/superAdmin/metrics.ts](lib/superAdmin/metrics.ts) — TODA a matemática do painel, pura e testada:
  `platformSummary()`, `tenantHealth()`, `attentionQueue()`, `growthSeries()`, `cohortRetention()`,
  `filterTenants()`/`sortTenants()`, `tenantsToCsv()`. Não existe histórico de MRR no schema, então
  as métricas derivam do estado atual de `platform_subscriptions` + `organizations.created_at`;
  cada aproximação está comentada no arquivo.
- [features/super-admin/platformQueries.ts](features/super-admin/platformQueries.ts) — leitura cross-org
  paginada (o PostgREST corta em 1000 linhas) que monta `TenantSnapshot[]`.
- Conta **cortesia** (`platform_subscriptions.is_comped`) tem acesso liberado mas fica fora do MRR.
- Ações que mexem em acesso/cobrança (suspender, estender trial, cortesia) gravam em
  `platform_admin_audit_log`.

### Supabase Clients

- [lib/supabase/client.ts](lib/supabase/client.ts) — `createClient()` for Client Components (uses `createBrowserClient`)
- [lib/supabase/server.ts](lib/supabase/server.ts) — `createClient()` for Server Components/layouts; `createAdminClient()` for admin role checks and service-level writes (bypasses RLS)

Never import `@supabase/supabase-js` directly — always use the wrappers above.

**Identidade/academia vem sempre dos helpers memoizados** de `lib/supabase/server.ts` (`getAuthUser`, `getMemberships`, `getActiveOrgId`, `getActiveMembership`, `getCurrentOrg`, `getStaffContext`). Eles são embrulhados em `requestCache` ([lib/utils/requestCache.ts](lib/utils/requestCache.ts)), então a cascata inteira custa 1 `auth.getUser()` + 1 select por request em vez de ~10. Nunca chame `supabase.auth.getUser()` direto numa página ou layout — some com o ganho. Em server action o valor congela no primeiro acesso do request: para reler algo que a própria action acabou de escrever, vá direto na tabela.

**Toda leitura de lista que cresce com o tamanho da academia passa por `fetchAllPages`** ([lib/supabase/paginate.ts](lib/supabase/paginate.ts)). O Supabase hospedado corta qualquer resposta em 1.000 linhas (`max_rows`), inclusive para a service role, e devolve `error: null` — a query "dá certo" com resultado errado. Use `chunk(ids, IN_CHUNK_SIZE)` para `.in(...)` com muitos ids (a lista vai na URL). Leitura com teto natural (uma sessão, um aluno, 20 notificações) pode usar `.select()` direto. Para contar, use `{ count: 'exact', head: true }` — nunca `select('id')` + `.length`, que trafega a tabela para contar no Node.

Crons varrem a base inteira: usam `fetchAllPages`, `mapWithConcurrency` ([lib/utils/concurrency.ts](lib/utils/concurrency.ts)) com orçamento de tempo, e respondem `truncated: true` quando não terminaram — o que sobrar fica para a próxima passada (todas as operações são idempotentes).

### Business Logic Utilities

| File | Purpose |
|---|---|
| [lib/utils/creditRules.ts](lib/utils/creditRules.ts) | `canCancelWithRefund()`, `getMakeupCreditExpiry()` — 5h cancellation window |
| [lib/utils/dateHelpers.ts](lib/utils/dateHelpers.ts) | `getDatesForDayOfWeekInMonth()`, `formatDate()`, `formatTime()` (pt-BR locale via date-fns) |
| [lib/utils/cn.ts](lib/utils/cn.ts) | `cn(...classes)` — clsx + tailwind-merge |
| [lib/checkin/selfCheckin.ts](lib/checkin/selfCheckin.ts) | `resolveSelfCheckinStatus()`, `selfCheckinWindow()`, `haversineMeters()` — geofence e janela (1h antes do início → 1h depois do fim) da confirmação de presença pelo aluno |
| [lib/liga/](lib/liga/) | `divisions.ts` (promoção/rebaixamento), `streak.ts` (semanas seguidas), `points.ts` (pesos), `sportForPoints.ts` (qual esporte a presença credita) e `medals.ts` (catálogo de medalhas) — regras puras da Liga |
| [lib/aulas/classRules.ts](lib/aulas/classRules.ts) | `buildClassRules()` — **única fonte** das regras que o aluno lê no modal de `/home` (`features/home/RulesCard.tsx` + `RulesModal.tsx`, montado por `features/aulas/classRulesQuery.ts`). Derivado da configuração real da academia, nunca texto fixo — o mesmo motivo do `RulesCard` da Liga. **Regra nova ou alterada no sistema de aulas (cota, teto diário, cancelamento, crédito, férias, acúmulo, check-in, kids) tem de atualizar este arquivo**, senão o modal passa a prometer o que o app não faz mais |
| [lib/aulas/icsFeed.ts](lib/aulas/icsFeed.ts) | `buildIcsCalendar()` — gera o `.ics` da agenda externa do aluno (RFC 5545), consumido por `app/api/calendar/[token]/route.ts`. Ver "Agenda externa (.ics)" abaixo |

These have Vitest unit tests co-located (`.test.ts` files).

### Data Model Key Points

All types are in [types/index.ts](types/index.ts). Key invariants:

- `memberships.credits_balance` is a **cached** value — source of truth is the `credit_transactions` table (a coluna saiu de `profiles` em `20260624000100_drop_profiles_per_org_columns.sql`: crédito é por-academia)
- Liga: `liga_points` é o extrato (verdade) e `liga_standings` é cache de posição, mesmo par ledger→cache do crédito. Escrita **só** pelas RPCs `liga_award_points` / `liga_revoke_points` (atômicas, `security definer`), nunca por update direto
- `classes` = recurring schedule templates; `class_sessions` = specific dated instances of a class
- Gerar a grade (`features/aulas/gridGeneration.ts`) tem **duas** metades: cria a
  sessão que falta (upsert idempotente pelo índice único `class_id,session_date`) e
  **reabre a que está cancelada**. A segunda existe porque índice não olha `status`,
  então sessão cancelada era conflito, era pulada, e ficava cancelada para sempre.
  Consequência que precisa estar clara: **cancelamento dentro da janela gerada não
  sobrevive à geração seguinte** — feriado marcado com antecedência tem de ser
  cancelado de novo depois que a grade rodar. Três travas seguram o resto: só toca
  em `cancelled` (aula `completed` tem chamada feita), só nas turmas **ativas** do
  escopo (senão "Gerar semana" desfaria `deleteClass`) e só nos pares (turma, data)
  que a geração produziria.
- Reabrir devolve a aula aos alunos **fixos** e só a eles, apagando as reservas
  marcadas com `session_bookings.cancelled_by_session` para
  `reconcileAllActiveEnrollments` recriá-las — é ele que revalida capacidade,
  férias, cota e pendência de check-in. Quem pagou com crédito não volta (o crédito
  já foi estornado; re-debitar pode falhar) e é convidado por notificação. O filtro
  é `cancelled_by_session`, **nunca** `admin_waived`: essa coluna também marca o
  aluno que o professor tirou daquela data, e ressuscitá-lo desfaria uma decisão da
  academia
- `enrollments` = fixed weekly schedule; `session_bookings` = per-session bookings (extra, makeup)
- **Fila de espera é entrada AUTOMÁTICA.** Vaga aberta → `promoteFromWaitlist`
  ([features/aulas/waitlistActions.ts](features/aulas/waitlistActions.ts)) coloca o primeiro
  da fila na aula pela porta normal (`bookSessionAs`, com `orgId` explícito porque a promoção
  roda sem usuário logado) e avisa por in-app/push/e-mail; quem ficou na frente recebe "virou
  o primeiro", **uma vez só** (`waitlists.first_notified_at`). Não existe mais o aviso de
  "abriu vaga" para a fila inteira. Três travas sustentam o desenho: **corte de 1h** antes do
  início ([lib/aulas/waitlistPromotion.ts](lib/aulas/waitlistPromotion.ts)) — promover quem
  não vai ver o aviso em tempo enche a turma no papel e esvazia na quadra, e 1h é a mesma
  janela de `BOOKING_GRACE_MINUTES`, o prazo que o aluno tem para sair sem penalidade;
  **entrar na fila exige poder entrar na aula** (`resolveStudentClassAccess`), senão dava
  para ficar na fila com dívida e descobrir só na promoção; e **quem deixou de poder entrar
  é removido da fila com aviso do motivo** — remover em silêncio deixaria a pessoa esperando
  para sempre por uma vaga que nunca viria. A ordem da fila é `joined_at`, nunca a coluna
  `position` (que não é recalculada). O convite manual por WhatsApp do professor
  (`WaitlistPanel`) continua existindo para quem foi barrado ou está fora do corte de 1h.
- **`resolveStudentClassAccess`** ([features/aulas/classAccessQuery.ts](features/aulas/classAccessQuery.ts))
  é a única coleta de dados de "esse aluno pode entrar nesta aula?" — plano, cota, teto
  diário, dívida, pendência de check-in, férias, cadastro inativo. Usada em três momentos que
  têm de concordar: reservar, entrar na fila e ser promovido pela fila. A regra em si continua
  pura em `resolveClassAccess` ([lib/utils/accessRules.ts](lib/utils/accessRules.ts)).
- Students with `memberships.partner: 'wellhub' | 'totalpass'` get check-ins via webhook (not manual). O eixo parceiro saiu de `payment_type` na migração `20260715000000_membership_partner_axis.sql` — `payment_type` hoje só distingue `subscriber` de `per_class`
- Dependents (`is_dependent: true`) link to a `parent_id` who handles payment
- Aluno **sem e-mail** é cadastro gerenciado pela academia: linha em `profiles` com UUID
  próprio, sem usuário de auth (a FK para `auth.users` caiu em `20260626000300`), e sem login.
  É o mesmo mecanismo do dependente, sem responsável — o caso da criança que não tem e-mail
  nem telefone. Converter depois em conta com login **não é possível** hoje: `createUser` não
  aceita id, então virar login significaria outro id e repontar todo o histórico. Quem tem
  e-mail deve ser cadastrado com ele.
- `memberships.age_group` (`'adult' | 'kids'`, default `adult`) é a leitura da academia sobre
  o aluno; `classes.type` é a da turma. Cruzar os dois (`lib/aulas/ageGroup.ts`) só **avisa** —
  nunca bloqueia, porque o adolescente na turma de adultos é caso legítimo. Não confundir com
  `setStudentType()` (`features/checkin/actions.ts`), que é o eixo cobrança/parceiro
- `memberships.archived_at` é a **exclusão lógica do aluno por academia** (null = ativo).
  Não confundir com `contract_active`, que é "assinatura ativa" — misturar as duas faria
  reativar a mensalidade ressuscitar um cadastro excluído. Inativar (`features/aulas/archiveStudent.ts`)
  encerra matrículas fixas, cancela reservas futuras com estorno e **cancela a assinatura
  via `adminCancelStudentPlan`** — nunca por update direto, porque aquela função cancela a
  preapproval no Mercado Pago primeiro; sem isso o responsável seguiria sendo cobrado.
  Crédito NÃO é zerado (é valor pago, e a ação é reversível). Toda listagem de aluno filtra
  `archived_at is null`; as exceções deliberadas são a ficha do aluno e a lista de dependentes
  do responsável, que precisam mostrar o inativo para dar caminho de reativação, e o mapa de
  memberships da chamada, porque aula passada continua listando quem saiu. A trava de
  agendamento mora em `resolveClassAccess` (`denied: 'archived'`, antes de parceiro e crédito)
  — necessária porque o crédito guardado, sozinho, concederia acesso.
- Presença tem três origens (`attendance.source`): `manual` (professor na chamada), `wellhub`/`totalpass` (webhook do parceiro) e `self` (aluno confirma pelo app). A confirmação do aluno é gravada em `self_checkins` com a evidência de GPS e só vira `attendance` quando `validated`; `pending` espera o professor aprovar. Ver [docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md](docs/superpowers/specs/2026-08-03-confirmacao-presenca-aluno-design.md)

- RLS: policy nenhuma chama `auth.uid()` cru nem `is_org_admin(coluna)` — as duas rodam **por linha**. A forma correta é `(select auth.uid())` e `organization_id in (select auth_admin_org_ids())`, que viram InitPlan (uma avaliação por statement). A migração `20260809000000_escala_rls_e_indices.sql` converteu as existentes e a verificação está no cabeçalho dela; policy nova já deve nascer assim. Medido em 300k linhas: 1.320ms → 44ms.

Migrations live in `supabase/migrations/` and must be applied via `supabase db push`.

### Agenda externa (.ics)

O aluno pode assinar a própria agenda de aulas no Google/Outlook/Apple/Android
Calendar via `/perfil` (`features/perfil/CalendarSyncForm.tsx`). Não é OAuth
— é um link pessoal (`memberships.calendar_feed_token`, gerado só na primeira
ativação) que qualquer app de calendário busca periodicamente
(`app/api/calendar/[token]/route.ts`, rota pública, autenticada pelo próprio
token). O `.ics` é remontado do zero a cada busca a partir do estado atual do
banco (`features/aulas/calendarFeedQuery.ts` + `lib/aulas/icsFeed.ts`) — não
existe fila nem evento disparado quando uma aula é criada/cancelada/remarcada:
uma aula cancelada simplesmente some da próxima lista, e a maioria dos apps de
calendário entende UID ausente como "remova este evento". Por isso a
atualização nunca é instantânea (depende de o app do aluno decidir buscar de
novo) e por isso NENHUM código de reserva/cancelamento/remarcação de aula
precisa saber que este recurso existe. Token por `membership` (não por
`profile`): aluno de duas academias tem dois links, um por academia. Aluno
dependente (`is_dependent: true`) não tem login, então não ativa isto sozinho
— o feed cobre só a própria matrícula do aluno logado, não a dos dependentes.

### Capacidade e limites de plano

`/super-admin/capacidade` responde "quando preciso subir de plano?" com data, não palpite. O cron diário `capacity-snapshot` grava um retrato (linhas e bytes por tabela, orgs, alunos, MAU, tamanho do banco) em `capacity_snapshots`; a página projeta por mínimos quadrados quando cada teto é cruzado. Regras puras e testadas em [lib/plataforma/capacity.ts](lib/plataforma/capacity.ts).

A mesma página traz mais duas leituras. **Simulação de escala** ([lib/plataforma/projecaoEscala.ts](lib/plataforma/projecaoEscala.ts)) extrapola do consumo real para um alvo (padrão: mil arenas × 300 alunos, ajustável por `?arenas=&alunos=`) — só a parte que cresce com aluno é multiplicada, o overhead fixo entra como parcela, e a projeção se declara não confiável abaixo de 200 alunos em vez de imprimir número bonito e errado. Ela assume o histórico por aluno de hoje, então `avaliarMaturidade` mostra a idade da base ao lado: em operação nova o número é **piso, não teto**. **Diagnóstico de arquitetura** ([lib/plataforma/diagnostico.ts](lib/plataforma/diagnostico.ts)) é um retrato datado dos achados da auditoria, não verificação viva — ao mexer num dos pontos, atualize o item.

O que o painel **não** mede está listado nele mesmo (`LIMITES_EXTERNOS`): CPU/RAM da instância e queries caras ficam no painel do Supabase, invocações e GB-hrs no da Vercel. Os tetos em `LIMITES` vêm dos planos publicados e envelhecem — confira o pricing antes de decidir por eles.

### Design System

Dark theme with orange brand. Key Tailwind tokens:

```
bg-surface        #0c1220  (page background)
bg-surface-card   #151e31  (cards/panels)
border-surface-border  #26334d
text-brand-500    #f97316  (primary orange)
Gradiente de marca: bg-gradient-to-br from-brand-600 to-brand-800 (headers/CTAs de destaque)
```

UI primitives live in [components/ui/](components/ui/): `Button`, `Card`, `Badge`, `Input`, `BottomNav`. Always use these rather than raw HTML elements for consistency.

### Versão do app e sessão

Este app **não tem cache de service worker**: o `@ducanh2912/next-pwa` está nas
dependências mas nunca foi ligado no `next.config.js`, e [public/sw.js](public/sw.js) é
escrito à mão só para push — o handler de `fetch` é um no-op presente apenas para o Chrome
considerar o app instalável. Então deploy novo já chega em qualquer carregamento de página;
o que segura código antigo é a janela do PWA aberta há dias.

[components/pwa/VersionGate.tsx](components/pwa/VersionGate.tsx) (montado no layout raiz)
compara a build inlinada no bundle com a de `/api/version`. Voltou de mais de 30 min em
segundo plano → recarrega sozinho; em uso → mostra o aviso, porque recarregar por cima de
uma chamada ou de um formulário meio preenchido destruiria trabalho do professor.

**Para exigir que todos entrem de novo**, bumpe `SESSION_EPOCH` em
[lib/version.ts](lib/version.ts). O `middleware.ts` limpa os cookies de sessão e manda para
o `/login` — no middleware, e não no cliente, para valer também para quem está rodando um
bundle antigo. Deploy de rotina **não** mexe nesse número: subi-lo derruba a base inteira.
Cookie de época ausente é tratado como "em dia", nunca como "precisa reautenticar" — senão o
próprio deploy que introduziu o mecanismo teria expulsado todo mundo.

### Responsividade

O app é usado em celular, e o piso é **320px** (iPhone SE), não 375. Há um breakpoint
extra `xs: 400px` em [tailwind.config.ts](tailwind.config.ts) — os defaults do Tailwind
começam em `sm: 640px`, então sem ele não havia como dizer "só em celular pequeno".
`pb-safe` depende do par `spacing.safe` + `viewportFit: 'cover'` (em [app/layout.tsx](app/layout.tsx));
os dois andam juntos, e sem o segundo `env(safe-area-inset-*)` resolve 0.

Dois defeitos se repetem — vale conhecer os dois antes de escrever linha nova:

1. **`flex justify-between` sem `gap-*` e sem `shrink-0` no chip da direita.** Os dois
   filhos encolhem até o min-content e se encostam. Quando o lado esquerdo é longo,
   empilhe (`flex-col xs:flex-row`) em vez de só `flex-wrap`: com `flex-1` a base é 0,
   então o chip nunca sai da linha e o texto vira uma coluna de uma palavra por linha.
2. **`truncate` em `<td>` de tabela auto-layout.** `truncate` implica `nowrap`, e o
   texto inteiro passa a contar para a largura mínima da tabela: as reticências nunca
   aparecem e um wrapper `overflow-hidden` amputa colunas em silêncio. Use
   `table-fixed` + `max-w-0` na célula.

`npm run test:responsive` mede isso em 320/375/414px sobre a bancada
[app/dev/responsivo](app/dev/responsivo/page.tsx) (fixtures fixas, **sem** Supabase — roda
em qualquer lugar). As asserções são três: nada estoura sem ser contido, rótulo de KPI
não passa de 2 linhas e valor de KPI não quebra. As duas últimas existem porque medir
estouro sozinho tem ponto cego: com quebra permitida, um rótulo em caixa estreita não
transborda — ele viborneia em 5 linhas, que é o defeito de verdade. Os screenshots
saem em `tests/.artifacts/bancada-<largura>px.png`. Ao mexer num componente da
bancada, atualize a fixture: ela replica o layout real e um teste sobre marcação
desatualizada passa sem medir nada.

### Planned but Not Yet Implemented

The `features/` directory (aulas, financeiro, torneios) and most dashboard pages are planned for Plan 2+. Most `app/(dashboard)/` pages currently show placeholder text. The spec is at [docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md](docs/superpowers/specs/2026-05-31-beach-tennis-app-design.md). Comunidade (`features/comunidade/`) já está implementada (feed social), mas saiu do menu do aluno — ver [docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md](docs/superpowers/specs/2026-07-31-video-cameras-iframe-design.md).

A aba "Vídeo" virou **Liga** (`/liga`; `/video` redireciona), com o vídeo como bloco interno. As quatro fases de [docs/superpowers/specs/2026-08-02-liga-gamificacao-aluno-design.md](docs/superpowers/specs/2026-08-02-liga-gamificacao-aluno-design.md) estão implementadas: motor de pontos e divisões, medalhas, elogios + comunidade e mural de fotos. A Liga nasce desligada por academia (`system_settings.liga_enabled`).

- Medalha (`liga_medals`) **não dá ponto** e o catálogo vive em código (`lib/liga/medals.ts`), não em tabela: acrescentar medalha é deploy, e a passada diária do cron `liga-streak` concede retroativamente a quem já cumpre o critério.
- Elogio (`liga_kudos`) é a única parte fraudável do sistema. As travas moram no **banco** (`unique (org, from, to, iso_week)`) e em `lib/liga/kudos.ts`; receber vale mais que dar de propósito. Elogio barrado pela trava é gravado assim mesmo, só sem ponto.
- O feed (`features/comunidade/`) voltou ao menu como **seção da Liga**; `/comunidade` redireciona. `posts.is_pinned` é o mural de comunicados do admin.
- Fotos de torneio (`tournament_photos`) vão para um bucket **privado**, servidas por URL assinada — ao contrário de `tournament-images` (capa, pública). Upload só por server action de admin.
- Três crons: `liga-streak` (diário), `liga-season-close` (dia 1º) e `liga-season-alert` (diário, dispara só a 2 dias do fim da temporada).
- Fontes extras de ponto (`features/liga/extraPoints.ts`) premiam comportamento que ajuda a academia: self check-in, cancelar dentro da janela, pegar vaga da fila, agendar com antecedência, cadastro completo (uma vez na vida) e day use. Todas best-effort — a Liga falhando nunca derruba a operação de origem.
- Premiação: `liga_prizes` é o que a academia **promete** (editável enquanto a temporada roda) e `liga_prize_awards` é o que ela **deve**, congelado no fechamento. Sem essa separação, reescrever o prêmio em janeiro mudaria retroativamente o que alguém ganhou em dezembro.
- O fechamento **avisa**: um push por aluno com o que aconteceu com ele (campeão, subiu, caiu), texto em `lib/liga/seasonCloseNotice.ts` e montagem em `buildSeasonCloseNotices`. Quem terminou com 0 ponto não recebe nada — avisar quem não apareceu é cobrança, não notícia. Best-effort: falha de aviso nunca desfaz um fechamento já gravado.
- **Não existe tabela de histórico de temporada** e não deve existir: `liga_standings` é escopado por `season_id` e o fechamento não apaga as linhas da temporada que fechou. `getSeasonHistory()` lê esse passado. "Campeão da temporada" é o 1º da divisão mais alta que teve alguém com ponto — e não o maior número de pontos da academia, que premiaria o volume do Bronze em vez do patamar.
- A régua do **cadastro completo** mora em `lib/liga/profileComplete.ts`, pura, e é usada nos dois lados: `checkProfileComplete` concede o ponto e `getProfileBonusStatus` diz ao aluno o que falta (card no Perfil). Mexer na régua num lugar só faz o app prometer ponto que o motor não paga — foi assim que o defeito original apareceu.
