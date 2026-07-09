# Design: Generalizar o app de "arena de areia" para qualquer academia

**Data:** 2026-07-09
**Status:** aprovação pendente

## Problema

O app foi construído com foco em arenas de esporte de areia (beach tennis). Hoje a
plataforma deve atender **qualquer academia ou escola esportiva** — futebol, crossfit,
pilates, funcional, luta, natação etc. — tudo que possa usar Wellhub/TotalPass e ter
alunos em aulas. Restam quatro pontos de "fixação" em beach tennis/areia que precisam
sair.

A marca **ArenaHub** é mantida; apenas o copy de marketing é ajustado para linguagem
genérica. Não há renomeação do produto neste escopo.

## Escopo (4 frentes)

### 1. Modalidades — lista ampliada + "Outro" (texto livre)

**Estado atual:** `lib/arenas/sports.ts` tem lista fixa de 5 esportes de areia/raquete
(beach_tennis, padel, futevolei, volei_praia, tenis). `normalizeSports()` descarta
qualquer entrada fora dessa lista. É metadado (tag) da organização, sem tabela.

**Mudança:**
- Ampliar `SPORTS` com modalidades comuns: crossfit, funcional, pilates, futebol,
  muay thai/luta, natação, tênis de mesa, vôlei de quadra, basquete, dança, yoga
  (mantendo as 5 atuais).
- Suportar **"Outro" (texto livre)**: `normalizeSports()` passa a aceitar entradas
  customizadas — sanitizadas (trim, limite de tamanho ~40 chars, sem duplicar) e
  prefixadas com `custom:` para distinguir dos slugs conhecidos. Slugs conhecidos
  continuam alimentando as facetas de filtro do diretório `/arenas`; entradas `custom:`
  aparecem só como tag de exibição, fora dos filtros.
- UI (`OnboardingForm`, `VitrineForm`): além dos chips fixos, um campo "Outro" que
  adiciona modalidade livre à lista selecionada.

**Arquivos:** `lib/arenas/sports.ts` (+ `sports.test.ts`), `app/onboarding/OnboardingForm.tsx`,
`app/(admin)/admin/configuracoes/VitrineForm.tsx`, `features/organizations/actions.ts`
(usa `normalizeSports` no `completeOnboarding`), exibição de tags no diretório.

### 2. Níveis — remover gating e esconder badge

**Estado atual:** hierarquia `iniciante < D < C < B < A` (`lib/utils/levelAccess.ts`).
`canStudentAttendLevel()` bloqueia entrada em turmas/torneios de nível superior. Chamado
em 6 pontos reais:
- `features/aulas/actions.ts:148` (ação de booking — o gate principal)
- `features/aulas/waitlistActions.ts:98` (fila de espera)
- `features/torneios/actions.ts:224` (inscrição em torneio)
- `app/(dashboard)/home/page.tsx:157` (filtro de turmas exibidas)
- `app/(dashboard)/agendar/page.tsx:36` (filtro)
- `features/aulas/BookingForm.tsx:36` (exibição no cliente)

**Mudança:**
- Remover as checagens de nível nos 6 pontos: qualquer aluno pode entrar em qualquer
  turma/torneio. Remover imports e o parâmetro `level` correlato onde só servia ao gate.
- **Esconder o badge de nível** na UI: perfil do aluno, cards de turma (`ClassCard`),
  home, e o seletor de nível nos formulários de turma (`ClassForm`, `EditClassForm`) e
  torneio (`CreateTournamentForm`). Sem seletor de nível ao criar turma/torneio.
- Manter as colunas `level` no banco (dormentes) — **sem migração destrutiva**. Só param
  de ser lidas/escritas pela UI. Sem chamadas restantes, `lib/utils/levelAccess.ts` e
  `lib/utils/levelAccess.test.ts` são **removidos**.

**Nota de escopo:** manter a coluna dormente evita migração e perda de dado histórico. Se
depois quiser um sistema de níveis genérico/configurável, é outro projeto.

### 3. Terminologia "Quadra" → "Espaço"

**Estado atual:** "Quadra 1/2" hardcoded nos formulários e cards; frases com "quadra"/"areia".

**Mudança — trocar para "Espaço" (Espaço 1 / Espaço 2):**
- Formulários/cards: `features/aulas/ClassForm.tsx`, `EditClassForm.tsx`,
  `features/dayuse/CreateDayUseForm.tsx`, `DayUseSlotCard.tsx`, `DayUseBookingCard.tsx`,
  `app/(dashboard)/home/page.tsx:434`.
- Copy: `app/arenas/[slug]/TrialBookingForm.tsx:51` ("Nos vemos na quadra!" → "Nos vemos
  por aí!"), `app/(dashboard)/perfil/page.tsx:313` ("emergência na quadra" → "emergência
  durante a aula"), `app/(dashboard)/agendar/page.tsx:264` e `agendar/dayuse/page.tsx:94`
  ("Reserve uma quadra avulsa" → "Reserve um espaço avulso").

**Fora de escopo:** o sistema hoje é limitado a 2 quadras/espaços hardcoded (1 e 2). Não
mudamos essa contagem agora — apenas o rótulo.

### 4. Copy da landing e metadados (marca ArenaHub mantida)

- `app/page.tsx`: "Plataforma para arenas de esporte de areia" → "Plataforma de gestão
  para academias e escolas esportivas"; generalizar os chips de esporte e o texto do hero
  ("sua arena lotada"); ajustar FAQ "Funciona pra outros esportes além de beach tennis?"
  para resposta afirmativa/genérica; suavizar frases "quem vive de quadra cheia" / "sinal
  fraco na areia".
- `app/_landing/LiveDemo.tsx`: cards demo "Beach Tennis · Nível X" → modalidades variadas
  e sem "Nível" (ex.: "Funcional · Ter 19:00 · Espaço 1").
- `app/layout.tsx`: meta description/OG "arenas de beach tennis, padel, futevôlei e mais"
  → "academias, escolas esportivas e estúdios".
- `lib/billing/platformPlan.ts:7`: "Assinatura Plataforma — Beach Tennis App" →
  "ArenaHub — Assinatura Plataforma".

## Testes

- `lib/arenas/sports.test.ts`: cobrir modalidades novas e o caminho "Outro"/`custom:`
  (sanitização, limite, dedup, rejeição de vazio).
- `lib/utils/levelAccess.test.ts`: remover (ou reduzir) junto com o gating.
- `npm run test:run` e `npm run lint` verdes ao final.

## Fora de escopo (explícito)

- Renomear o produto ArenaHub.
- Sistema de níveis genérico/configurável por academia.
- Aumentar a contagem de quadras/espaços além de 2.
- Migração destrutiva das colunas `level`.
