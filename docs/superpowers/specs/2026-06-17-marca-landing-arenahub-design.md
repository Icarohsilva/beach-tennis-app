# Marca + Landing (ArenaHub) — Design

> Brainstorming validado em 2026-06-17. Primeiro dos três subsistemas da fase de
> "experiência/posicionamento" (os outros: **Aula experimental por região** e, por último,
> **Plano 3 — Cobrança SaaS**, cuja spec já está parqueada em
> `2026-06-17-plano-3-cobranca-saas-design.md`).

## Contexto

O app nasceu single-tenant para a Academia Hudson Barros e hoje é multi-tenant (Planos 1 e 2:
academias se cadastram sozinhas, alunos entram por convite). Mas a **marca ainda é fixa no
Hudson / "BT App"** e a home (`app/page.tsx`) é uma telinha mobile com nome fixo. Para vender o
sistema como SaaS para arenas/academias de esporte, precisamos de **identidade própria
(ArenaHub)**, uma **landing de marketing** de verdade, e **despersonalizar** o que está
preso ao Hudson.

## Decisões (todas confirmadas com o usuário)

- **Nome do SaaS:** **ArenaHub**. Domínio **`arenahub.pro`** (`.com.br` e variantes Arena
  comuns estavam tomadas; `.pro` livre — confirmar na compra).
- **Arquitetura de marca em duas camadas:**
  1. **Marca da plataforma (ArenaHub):** aparece onde ainda não há academia no contexto —
     landing, páginas de auth (login/cadastro/criar-academia), componente `Logo`, metadados.
  2. **Marca da academia (dinâmica):** pós-login, mostrar o **nome da própria academia**
     (`organizations.name`). Logo/cores por academia = **Plano 4** (fora daqui).
- **Direção da landing:** foco na academia (quem paga) no hero, com a porta do aluno presente.
- **Logo v1:** **wordmark simples** (ícone 🏟️ + "Arena" branco + "Hub" laranja), em texto/SVG.
  Sem depender de designer; trocável por um logo profissional depois sem refatorar.
- **Imagens:** baixar as fotos Unsplash validadas para `public/landing/` e servir via
  `next/image` (licença Unsplash permite uso comercial) — **sem hotlink** em produção.
- **CTA do aluno** ("Encontrar uma arena") aponta para `/experimental` por enquanto; vira a
  busca por região quando aquele plano sair.

## Mockup de referência

A landing validada (alta fidelidade) está em
`.superpowers/brainstorm/1241-1781726644/content/landing-hifi.html`. É a fonte visual da
implementação (estrutura, seções, cores, animações).

## Escopo

### 1. Rebrand (de "BT App / Hudson" → ArenaHub)

Arquivos e mudanças exatas:

- **`app/layout.tsx`** — `metadata`:
  - `title: 'ArenaHub — Gestão para arenas e academias de esporte'`
  - `description: 'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.'`
  - `appleWebApp.title: 'ArenaHub'`
  - Manter `viewport.themeColor: '#ea580c'` (laranja da marca).
  - Adicionar Open Graph (`openGraph: { title, description, images: ['/og.png'], url }`) para a landing — bom pra compartilhamento.
- **`public/manifest.json`** — `"name": "ArenaHub"`, `"short_name": "ArenaHub"`.
- **`components/ui/Logo.tsx`** — virar wordmark ArenaHub:
  - `variant='full'` → `🏟️ Arena` + `Hub` (Hub em `text-brand-500`), como `<span>`/SVG, não `<Image>`.
  - `variant='icon'` → só `🏟️` (ou um pequeno SVG).
  - **Corrigir o bug** `src="public/icon.svg"` (caminho inválido) ao remover o uso de `<Image>`.
  - `alt`/texto: "ArenaHub".
- **`app/(auth)/layout.tsx`** — trocar `<p>Academia Hudson Barros</p>` por subtítulo da
  plataforma (ex.: "Gestão para arenas e academias") usando o `Logo`. Antes do login, **nunca**
  mostrar nome de academia.

### 2. Landing nova — `app/page.tsx`

Reescrever de Server Component estático (sem dados; pode permanecer estático/edge). Estrutura
(conforme o mockup):

1. **Nav fixa** (`sticky`, blur): wordmark ArenaHub · links (Recursos, Para alunos, Preço) ·
   "Entrar" (`/login`) · "Criar conta grátis" (`/criar-academia`, botão laranja).
2. **Hero** full-width: imagem de ação (overlay escuro p/ legibilidade), eyebrow "Plataforma
   para arenas e academias", H1 "Sua arena cheia. Sua gestão no automático.", subtítulo,
   CTAs ("Criar conta grátis" → `/criar-academia`; "Ver como funciona" → âncora `#rec`),
   selo "1º mês grátis · sem cartão". **Ícones de esporte flutuantes animados** (CSS
   keyframes — 🎾🏐🏆🥎).
3. **Faixa de esportes** (chips): Beach Tennis · Padel · Futevôlei · Vôlei de Praia · Tênis.
4. **Grade de recursos** (6 cards com ícone + hover lift): Grade & agendamento · Créditos &
   reposição · Check-in (Wellhub/TotalPass) · Financeiro · Torneios · Comunidade.
5. **Seção "Para quem joga"** (split com foto): achar arena por região + agendar experimental.
   CTA "Encontrar uma arena" → `/experimental`.
6. **Teaser de preço**: "Comece de graça · R$ 39,90/mês · 1º mês por nossa conta" + CTA.
7. **Footer**: wordmark + "© 2026 ArenaHub · arenahub.pro".

Implementação:
- **Responsiva** (mobile-first; o mockup já define breakpoints).
- **Fontes:** Sora (display/headings) + Inter (corpo) via `next/font/google`.
- **Imagens:** salvar em `public/landing/` (hero e foto do aluno), servir com `next/image`.
  IDs Unsplash validados (HTTP 200): hero `photo-1638873194946-ae8c1aced4c4`, aluno
  `photo-1519046947096-f43d6481532b`. (Alternativas validadas, se preferir trocar:
  `1612872087720-bb876e2e67d1`, `1526888935184-a82d2a4b7e67`, `1659411587993-4aa949993f25`.)
- Usar primitivos/tokens do design system onde fizer sentido (`Button`, cores `brand-*`,
  `surface*`), mas a landing pode ter CSS próprio de marketing (gradientes, animações).

### 3. Nome da academia dinâmico (pós-login)

- Auditar dashboard (`app/(dashboard)/layout.tsx`) e admin (`app/(admin)/layout.tsx` e
  cabeçalhos) para garantir que qualquer nome de academia exibido venha de `organizations.name`
  do usuário logado (já temos `getCurrentOrg()`/`getStaffContext()`), **não** de string fixa.
- Onde hoje não há nome, exibir o nome da org no cabeçalho (toque de personalização barato e
  correto pra multi-tenant). Logo/cores próprios ficam para o Plano 4.

### 4. Domínio (parte ação do usuário, parte config)

Passos (documentados; compra é do usuário):
1. Comprar `arenahub.pro` num registrador.
2. Adicionar o domínio no projeto da Vercel e configurar os registros DNS indicados.
3. Definir `NEXT_PUBLIC_SITE_URL=https://arenahub.pro` na Vercel (e `.env.local`).
4. Auditar usos da URL de produção fixa: o fallback
   `'https://beach-tennis-app-pi.vercel.app'` em `app/(admin)/admin/equipe/...` (links de
   convite) deve passar a usar `NEXT_PUBLIC_SITE_URL`.

## Verificação

1. `npm run build` — sem erros (metadata, next/font, next/image).
2. `npm run test:run` — testes existentes seguem passando (esta entrega não tem lógica
   testável por unidade; é UI/marca).
3. **Visual manual:** landing em desktop e mobile (hero, animações, grade, seção do aluno,
   preço); CTAs levam a `/criar-academia`, `/login`, `/experimental`.
4. **Sem vazamento de marca:** nenhuma ocorrência de "Hudson"/"BT App"/"Beach Tennis App" em
   `app/`, `components/`, `public/` (grep limpo). Pós-login mostra o nome da org logada.
5. Após o domínio: invite links e (futuramente) back_url do MP usam `arenahub.pro`.

## Fora de escopo (outros planos)

- **Aula experimental por região** (busca/descoberta de arenas próximas) — subsistema próprio.
- **Personalização por academia** (logo/cores) e painel super-admin → Plano 4.
- **Cobrança SaaS** → Plano 3 (spec parqueada).
- Logo profissional desenhado (o wordmark v1 cobre o lançamento).

## Pré-requisitos / dependências externas

- Compra de `arenahub.pro` + DNS na Vercel + `NEXT_PUBLIC_SITE_URL`.
- (Opcional) imagem `public/og.png` para Open Graph.
