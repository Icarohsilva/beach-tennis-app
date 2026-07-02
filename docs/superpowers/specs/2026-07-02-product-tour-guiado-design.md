# Product Tour Guiado + Central de Ajuda — Design

**Data:** 2026-07-02
**Status:** Aprovado (aguardando revisão do spec)

## Objetivo

Implementar um tour guiado interativo (passo a passo, estilo "robozinho") que roda automaticamente no primeiro login de alunos e admins, além de uma "Central de Ajuda" para rever o tutorial e consultar FAQs a qualquer momento.

## Stack

Next.js 14 App Router · React · TypeScript · Tailwind · Supabase · Vitest.

## Biblioteca escolhida: Driver.js

- **Driver.js** (`driver.js`, ~5kb gzip, licença MIT) — leve, framework-agnóstico, aponta para elementos via seletores CSS, integra bem com App Router e não acopla à versão do React.
- **React Joyride** — descartado: ~30kb+, mais pesado, mais atrito em re-renders.
- **Intro.js** — descartado: exige licença comercial paga. O app é SaaS com cobrança (`/admin/assinatura`), então licenciamento seria um problema.

## Persistência (fonte de verdade)

Duas colunas novas em `profiles` (migration em `supabase/migrations/`):

- `tour_aluno_seen_at timestamptz` — marcada quando o aluno conclui **ou** pula o tour.
- `tour_admin_seen_at timestamptz` — idem para o admin.

**Decisão:** sem localStorage. A flag no banco evita repetição cross-device (o tour não reaparece se o usuário troca de celular ou limpa cache). Lida no layout (Server Component) e passada ao controlador do tour como `autoStart = !tour_*_seen_at`.

Ao concluir/pular, o `TourProvider` chama uma Server Action `markTourSeen(variant)` que grava o timestamp usando `createClient()` (RLS — o próprio usuário atualiza seu `profiles`).

## Componentes e arquivos novos

| Arquivo | Papel |
|---|---|
| `components/tour/TourProvider.tsx` | Client. Inicializa Driver.js, define passos por variante, controla auto-start e replay. Props: `variant: 'aluno' \| 'admin'`, `autoStart: boolean`. |
| `components/tour/HelpButton.tsx` | Client. Botão flutuante discreto "Central de Ajuda" (`HelpCircle`). Menu: "Ver tutorial novamente" (replay) e "Perguntas frequentes" (abre FaqModal). |
| `components/tour/FaqModal.tsx` | Client. Modal com FAQs em accordion, recebe lista conforme a variante. |
| `lib/tour/steps.ts` | Definição dos passos (aluno e admin) num só lugar. |
| `lib/tour/faqs.ts` | Conteúdo das FAQs (fácil de editar). |
| `lib/tour/autostart.ts` | `shouldAutoStart(variant, pathname, seenAt)` — lógica pura, testável. |
| `app/(dashboard)/actions.ts` (ou similar) | Server Action `markTourSeen(variant)`. |

`TourProvider` + `HelpButton` são montados nos layouts `app/(dashboard)/layout.tsx` e `app/(admin)/layout.tsx`, recebendo `variant` e `autoStart` do servidor.

## Marcação de alvos (`data-tour`)

Atributos `data-tour="..."` adicionados nos elementos reais. Driver.js aponta para esses seletores.

### Tour do Aluno (`app/(dashboard)/`) — 4 passos

| # | Passo | Alvo |
|---|---|---|
| 1 | Boas-vindas ao seu painel | header/topo (`tour-aluno-welcome`) — passo centrado, sem highlight |
| 2 | Aqui ficam suas aulas disponíveis | item **Aulas** do BottomNav (`tour-aluno-aulas`) + menção ao botão **Agendar** |
| 3 | Acompanhe seu progresso e conquistas | card de progresso na Home (`tour-aluno-progresso`) |
| 4 | Seu perfil e a Central de Ajuda | item **Perfil** (`tour-aluno-perfil`) + botão de ajuda (`tour-help-button`) |

**A "área de suporte" (passo 4) é a própria Central de Ajuda** — não há área de suporte separada; o botão flutuante cumpre esse papel.

### Tour do Admin (`app/(admin)/`) — 5 passos

| # | Passo | Alvo |
|---|---|---|
| 1 | Boas-vindas — visão geral dos números | **Dashboard** (`tour-admin-dashboard`) |
| 2 | Cadastre novos alunos e turmas | **Alunos** / **Grade de Aulas** (`tour-admin-cadastro`) |
| 3 | Crie e gerencie torneios | **Torneios** (`tour-admin-torneios`) |
| 4 | Relatórios e faturamento | **Financeiro** (`tour-admin-financeiro`) |
| 5 | Configurações gerais | **Configurações** (`tour-admin-config`) |

Torneios entram **apenas** no tour do admin.

## Central de Ajuda (botão flutuante)

- Ícone `HelpCircle` discreto, `position: fixed`, canto inferior. No aluno acima do `BottomNav` (offset ~pb-24); no admin, canto inferior direito.
- Menu com duas ações:
  - **Ver tutorial novamente** → reinicia o tour da variante da página atual.
  - **Perguntas frequentes** → abre o `FaqModal`.
- No mobile do admin, os alvos da sidebar vivem no `AdminMobileNav`; o replay considera esse menu para os alvos ficarem visíveis.

## FAQs (rascunho inicial, `lib/tour/faqs.ts`)

**Aluno:**
- Como agendar uma aula?
- Como cancelar e recuperar meu crédito? (janela de 5h)
- Como alterar minha senha?
- O que são os níveis (iniciante / D / C / B / A)?
- Como funciona o check-in via Wellhub/TotalPass?

**Admin:**
- Como cadastrar um aluno?
- Como criar uma turma na grade?
- Como criar um torneio?
- Onde vejo o faturamento?
- Como alterar minha senha?

Textos são rascunho, para o usuário revisar depois.

## Edge cases

- **Auto-start do aluno só na `/home`** (onde o card de progresso do passo 3 existe). Se o 1º login cai em outra rota, o auto-start aguarda a Home. O admin auto-inicia em qualquer rota do painel (alvos ficam na sidebar, presente em todas).
- Se o alvo de um passo não existir, Driver.js ajusta para passo centrado — não quebra.
- `tour_*_seen_at` marcado ao concluir **ou** pular — não reaparece.
- Academia suspensa renderiza `SuspendedNotice` (sem layout normal) → tour e HelpButton não aparecem lá.

## Testes

Vitest (unit, lógica pura):
- `lib/tour/steps.ts` — retorna os passos corretos por variante.
- `lib/tour/autostart.ts` — `shouldAutoStart(variant, pathname, seenAt)` cobre: aluno só na `/home`, admin em qualquer rota, não inicia se `seenAt` preenchido.

A UI do Driver.js não é coberta por unit test — validação manual no dev server (golden path + replay + FAQ, aluno e admin).

## Fora de escopo

- Analytics de conclusão do tour.
- Tours contextuais por feature específica (só o tour de onboarding geral).
- Internacionalização (app é pt-BR).
