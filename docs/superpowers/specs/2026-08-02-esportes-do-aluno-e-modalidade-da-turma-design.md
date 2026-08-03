# Esportes do aluno + modalidade da turma — Design

Data: 2026-08-02

## Contexto

Está em construção uma aba de **Liga** (ranking de temporada acumulado entre torneios —
o "Sub-projeto 3" listado como fora de escopo em
[2026-06-26-motor-torneios-fundacao-design.md](2026-06-26-motor-torneios-fundacao-design.md)).
Para que o rank saiba **de quais rankings cada pessoa participa**, falta o dado de base:
quais esportes o aluno pratica naquela academia.

Hoje esse dado não existe em lugar nenhum:

- `organizations.sports` (`text[]`) diz o que a **academia oferece**;
- `tournaments.sport` (`text`) diz o esporte do **torneio**;
- o **aluno** não tem esporte, e a **turma** também não.

Falta também identificar a "categoria" de cada turma. Decisão do produto: **categoria de
turma é o próprio esporte** (Beach Tennis, Futevôlei, …), uma por turma, e ela é
**puramente informativa — não bloqueia o acesso de aluno nenhum**.

Isso é coerente com [2026-07-09-generalizar-multi-modalidade-design.md](2026-07-09-generalizar-multi-modalidade-design.md),
que removeu de propósito todo o gating por nível: `lib/utils/levelAccess.ts` foi deletado e
`classes.level` / `memberships.level` ficaram dormentes. A modalidade **não** reintroduz
esse tipo de trava por outro nome.

## Decisões

1. **Os esportes do aluno vivem em `memberships`**, não em `profiles`. Como `level`,
   `payment_type` e `credits_balance`, é campo por-academia: a mesma pessoa pode jogar beach
   tennis numa arena e futevôlei em outra, e o rank de cada academia lê só os esportes dali.
2. **Modalidade da turma é coluna única `classes.sport`**, nullable (`null` = "sem
   modalidade"). Sem tabela de categorias.
3. **A fonte dos esportes continua sendo `lib/arenas/sports.ts`** — lista fixa de slugs +
   entradas livres `custom:`, sem tabela. É o mesmo modelo que `organizations.sports` e
   `tournaments.sport` já usam.
4. **O domínio é o cardápio da academia** (`organizations.sports`). Academia que ainda não
   declarou modalidade nenhuma cai na lista completa — senão o campo nasceria vazio e
   inutilizável. O aluno **não** digita esporte livre; só escolhe entre os da academia.
5. **Zero gating.** Nenhum ponto de reserva passa a olhar `sport`.

## Arquitetura

### Dados — `supabase/migrations/20260802000000_sports_membership_and_class.sql`

```sql
alter table memberships add column if not exists sports text[] not null default '{}';
alter table classes     add column if not exists sport  text;

create index if not exists memberships_org_sports_idx on memberships using gin (sports);
create index if not exists classes_org_sport_idx on classes (organization_id, sport);
```

Backfill **conservador**: só academias que declararam exatamente uma modalidade recebem
valor automático (turmas e memberships). Academia multi-modalidade fica em branco para o
admin preencher — chutar seria pior que o campo vazio. Idempotente: só toca linha ainda
não preenchida.

RLS não muda: `memberships` não expõe `update` para `authenticated`; toda escrita passa por
`createAdminClient()` dentro de server action autorizada.

### Trigger `handle_new_user`

O cadastro público manda os esportes escolhidos no `user_metadata` do `signUp`
(`sports: "slug_a,slug_b"`) e o trigger grava em `memberships.sports`.

Por que no trigger e não numa server action pós-signup: quando a academia exige confirmação
de email o `signUp` **não devolve sessão**, e uma action que recebesse o `user_id` do cliente
seria IDOR — risco que o código já documenta em `features/organizations/actions.ts` a respeito
de `acceptLegalDocuments`. No trigger o `new.id` vem do próprio Auth.

Guarda de domínio: os slugs do metadata são interseccionados com `organizations.sports` da org
resolvida, espelhando `normalizeSportsForOrg` em TS (mesmo fallback quando a academia não tem
cardápio).

### Domínio — `lib/arenas/sports.ts` (reuso) + 3 funções puras novas

`SPORTS`, `SPORT_BY_SLUG`, `normalizeSports()`, `sanitizeCustomSport()`, `isCustomSport()` e
`sportLabel()` continuam como estão. Acrescentado:

- `sportEmoji(slug)` — emoji do slug, genérico (`🏅`) para `custom:`/desconhecido;
- `sportOptionsForOrg(orgSports)` — cardápio da academia, com fallback para a lista completa;
- `normalizeSportsForOrg(input, orgSports)` — **o único validador server-side** dos esportes
  de um aluno;
- `normalizeSportForOrg(input, orgSports)` — variante de valor único, para a turma.

`lib/arenas/orgSports.ts` (novo): `getOrgSports(orgId)` lê `organizations.sports` via service
role para os server components/actions que precisam do cardápio.

### UI — esportes do aluno

`components/ui/SportsPicker.tsx` ganhou props opcionais (`options`, `label`, `allowCustom`)
sem mudar o comportamento dos dois usos existentes (`OnboardingForm`, `VitrineForm`). Para
aluno: `options={orgSports}` e `allowCustom={false}`.

| Onde | Como o dado entra |
|---|---|
| `app/(auth)/cadastro/page.tsx` (link de convite) | `resolveInviteCode` agora devolve `sports`; sem login → metadata do `signUp` → trigger; já logado → `joinAcademy(code, sports)` |
| `features/organizations/actions.ts` → `joinAcademy` | grava no insert da membership; se já participava e o campo está vazio, preenche (nunca sobrescreve escolha anterior) |
| `app/(admin)/admin/alunos/CriarAlunoButton.tsx` → `createStudent` | `sports` no `CreateStudentInput`, entregue via metadata do `createUser` |
| `.../alunos/[id]/StudentProfileClient.tsx` → `updateStudentSports` | espelha `updateStudentLevel` (mesma autorização via `requireAdmin`) |
| `app/(dashboard)/perfil/page.tsx` → `features/perfil/SportsForm.tsx` → `selfSetSports` | espelha `GenderForm` / `selfSetGender`: `user.id` vem da sessão |
| `app/(admin)/admin/alunos/page.tsx` | chips por aluno + filtro GET `esporte` via `.contains('sports', [slug])` |
| `app/(public)/t/[id]/cadastrar/` | quem cria conta por um torneio de futevôlei já entra praticando futevôlei |

### UI — modalidade da turma

- `ClassFormData` ganhou `sport`; `createClass`/`updateClass` validam com
  `normalizeSportForOrg`. Em `updateClass`, a modalidade **já gravada** continua válida mesmo
  se a academia parou de oferecê-la — reeditar a turma por outro motivo não pode zerar o campo.
- Seletor "Modalidade" (`Sem modalidade` + cardápio) em `ClassForm` e `EditClassForm`, com a
  legenda "Só identifica a turma. Não impede nenhum aluno de reservar."
- Exibição: `ClassCard`, `/admin/grade`, `WeekAgenda` e `SessionModal` (exigiu somar `sport`
  ao select de `class_sessions` em `app/(dashboard)/home/page.tsx`).
- `/agendar` ganhou chips de filtro **de exibição** (`?esporte=`), padrão "Todas", que só
  reduzem a lista renderizada. Aparecem apenas quando a grade tem mais de uma modalidade.

## Não-gating (explícito)

`features/aulas/actions.ts` (`bookSession`), `features/aulas/waitlistActions.ts`
(`joinWaitlist`), `enrollStudentInClass`, `lib/utils/accessRules.ts` e o seletor de turmas de
`app/(admin)/admin/alunos/[id]/page.tsx` **não foram tocados**. O único filtro de turma
continua sendo o de kids/dependente. Aluno que só pratica beach tennis reserva turma de
futevôlei normalmente.

## Testes

- `lib/arenas/sports.test.ts`: `sportEmoji`, `sportOptionsForOrg` (cardápio, custom, fallback,
  slug inválido), `normalizeSportsForOrg` (fora do cardápio, dedup, fallback, custom, nulo) e
  `normalizeSportForOrg`.
- `features/aulas/class-form-actions.test.ts`: modalidade do cardápio é gravada; modalidade
  fora do cardápio vira `null`; turma sem modalidade continua válida.
- `npm run test:run`, `npm run lint` e `npm run build` verdes.

## Fora de escopo

- A aba Liga / motor de ranking em si — esta entrega é só o dado de base.
- Categoria/nível do aluno **por esporte** (ex.: "Beach Tennis → categoria B"): fica para a
  spec da Liga.
- Tabela de esportes ou de categorias.
- Reativar as colunas `level` (seguem dormentes).
