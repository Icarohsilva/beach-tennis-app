# Auditoria de Regras + Redesign "Sport Bold"

**Data:** 2026-06-11
**Status:** Aprovado para planejamento

## Objetivo

Duas frentes, executadas em sequência ("fundação primeiro"):

1. **Auditoria completa das regras de negócio** — encontrar e corrigir bugs, brechas e inconsistências nas regras de agendamento, créditos, cancelamento e fila de espera.
2. **Evolução do layout** — design system "Sport Bold" (evolução do tema dark + laranja atual) aplicado a todas as telas do app do aluno e do painel admin.

O redesign só começa depois que as regras estiverem corretas e testadas, para que as novas telas nasçam sobre comportamento confiável.

## Decisões de escopo (validadas com o usuário)

| Decisão | Escolha |
|---|---|
| Áreas | App do aluno **e** painel admin |
| Regras | Auditoria completa, com correções aplicadas |
| Ousadia visual | Evoluir tema dark + laranja (não é redesign do zero) |
| Direção visual | **C — Sport Bold** (escolhida via mockups no companion visual) |
| Estrutura | Fundação primeiro: regras → design system → telas |

## Fase 1 — Auditoria de Regras de Negócio

### Inventário de regras a validar

**Agendamento** (`features/aulas/actions.ts`):
- Hierarquia de nível: iniciante < D < C < B < A (`lib/utils/levelAccess.ts`)
- Turma kids exclusiva para dependentes (`is_dependent`)
- Limite de 2 aulas confirmadas por dia por aluno
- Bloqueio de agendamento duplicado na mesma sessão
- Capacidade máxima da turma (`max_students`)
- Alunos wellhub/totalpass não consomem créditos

**Créditos** (`lib/utils/creditRules.ts` + actions):
- Débito de 1 crédito em agendamento avulso (subscriber/avulso)
- Reembolso apenas com cancelamento > 5h antes da sessão
- Crédito extra sem vencimento para aluno fixo (subscriber) que cancela com antecedência
- Crédito de reposição com validade (30 dias, configurável em `system_settings.credit_expiry_days`)
- Consistência entre `profiles.credits_balance` (cache) e `credit_transactions` (fonte da verdade)

**Cancelamento / Skip**:
- `cancelBooking` — cancela avulso, janela de 5h
- `skipEnrollmentSession` — aluno fixo sai de uma aula específica sem perder a matrícula
- `skipEnrollmentNoBooking` — skip preventivo quando a reserva semanal ainda não foi gerada

**Fila de espera** (`features/aulas/waitlistActions.ts`):
- join/leave/accept/offer, posições, cron diário de avanço

**Outros**: day use (sem crédito, capacidade), torneios (inscrição), dependentes (vínculo com `parent_id`), check-in wellhub/totalpass via webhook.

### Bugs já identificados na leitura inicial (corrigir na Fase 1)

1. **Timezone na janela de 5h** — `cancelBooking` monta `sessionStartIso` como `` `${session_date}T${start_time}` `` sem offset. Na Vercel o runtime é UTC e os horários das aulas são de Brasília (UTC-3): a janela real fica deslocada em 3 horas. Correção: anexar offset `-03:00` (ou usar `America/Sao_Paulo` via date-fns-tz) ao montar o instante da sessão. Adicionar testes cobrindo o limite da janela.
2. **Regra do aluno fixo divergente do código** — `skipEnrollmentSession` só devolve crédito se `credit_used = true`, mas a regra de negócio (confirmada com o usuário) é: **aluno fixo sempre ganha crédito de reposição ao sair de uma aula específica**. Corrigir o código para sempre creditar (crédito sem vencimento), independente de `credit_used`.
3. **Race condition de capacidade** — checagem de lotação e insert de booking não são atômicos; dois alunos simultâneos podem ultrapassar `max_students`. Correção: função RPC no Postgres (migration) que valida capacidade e insere na mesma transação com lock, usada por `bookSession`.
4. **Saldo de créditos não-atômico** — todos os pontos que fazem read-modify-write de `credits_balance` (book, cancel, skip) podem perder atualizações concorrentes. Correção: RPC `adjust_credits(student_id, delta, ...)` que insere a transação e atualiza o saldo atomicamente (`credits_balance = credits_balance + delta`), reutilizada em todas as actions.
5. **Limite ">" vs "≥" na janela de 5h** — `canCancelWithRefund` usa `>` enquanto a documentação diz "≥5h". Definir o comportamento no teste (adotar `>=`) e alinhar textos da UI.

A auditoria pode revelar bugs adicionais; cada um segue o mesmo tratamento (correção + teste).

### Entregáveis da Fase 1

- Correções nas actions + utilitários
- Migration(s) Supabase com RPCs de atomicidade (aplicadas via `supabase db push`)
- Testes Vitest para cada regra corrigida (co-locados, padrão existente)
- Documento curto `docs/superpowers/specs/2026-06-11-auditoria-regras-resultado.md` listando cada regra verificada e o veredito (ok / corrigida)

## Fase 2 — Design System "Sport Bold"

Evolução do tema atual, com energia esportiva: tipografia forte, gradiente laranja como elemento de marca, alto contraste.

### Tokens (tailwind.config.ts)

| Token | Hoje | Sport Bold |
|---|---|---|
| `surface` (fundo) | #0f172a | #0c1220 (mais profundo) |
| `surface-card` | #1e293b | #151e31 |
| Gradiente de marca | — | `from-brand-600 to-brand-800` (headers, sidebar admin, CTAs de destaque) |
| Badges | translúcidos | sólidos laranja com texto escuro (alto contraste) |
| Destaque de card | — | borda lateral laranja 3px |
| Títulos | `font-bold` | `font-extrabold`; labels em caps + `tracking-wide` |

### Componentes (components/ui/)

**Novos:**
- `StatHeader` — header com gradiente laranja e estatísticas (usado na Home do aluno: créditos, aulas/semana, nível; alunos wellhub/totalpass veem check-ins no lugar de créditos)
- `StatCard` — métrica individual (dashboard admin e perfil)
- `EmptyState` — ícone + mensagem + CTA padronizados
- `Skeleton` — blocos de loading; cada rota ganha `loading.tsx`
- `SectionHeader` — título de seção + link "ver todos"

**Evoluídos:** `Button`, `Card`, `Badge`, `Input`, `BottomNav`, sidebar admin — atualizados aos novos tokens; todas as telas herdam automaticamente. Micro-interações: `active:scale-[0.98]` em elementos tocáveis, transições de cor/borda, feedback otimista nas ações de agendar/cancelar.

### Admin

Mesmos tokens com densidade maior (tabelas, filtros). Sidebar com gradiente da marca. Sem mudança de informação ou fluxo — apenas visual e consistência.

## Fase 3 — Telas do Aluno

Ordem por impacto. Conteúdo e regras não mudam, salvo onde indicado.

1. **Home** — `StatHeader` substitui saudação + card de créditos; seções (Aulas de hoje, Day Use, Próximas Aulas, Torneios) com `SectionHeader`; cards Sport Bold com ações inline existentes
2. **Agendar + Day Use** — cards de sessão com estados visuais claros: disponível / lotada (com fila e posição) / já agendado; borda-destaque na próxima aula do aluno
3. **Aulas (Minhas Aulas)** — lista com ações de sair/ver colegas no novo padrão
4. **Comunidade** — cards de post no novo estilo, `EmptyState` para feed vazio
5. **Perfil** — créditos/plano/dependentes/dados médicos reorganizados em seções com `StatCard`s
6. **Login / Cadastro / Recuperar senha** — gradiente da marca, mesmos formulários

## Fase 4 — Telas do Admin

7. **Dashboard** — `StatCard`s: alunos ativos, aulas hoje, receita do mês, inadimplentes
8. **Grade** — cards de turma mais escaneáveis (badges sólidos, contagem de vagas em destaque)
9. **Alunos, Financeiro, Torneios, Notificações, Configurações** — herdam tokens; ajustes pontuais de densidade e consistência

## Tratamento de erros e estados

- Toda action continua retornando `{ error?: string }`; as telas exibem o erro no padrão visual novo (toast/banner consistente em vez de `alert`/texto ad-hoc)
- Estados vazios sempre via `EmptyState`; loading sempre via `Skeleton`/`loading.tsx`
- Ações otimistas revertem visualmente se a action retornar erro

## Critérios de aceite / verificação

- Cada fase termina com `npm run build` e `npm run test:run` verdes e commit separado
- Fase 1: cada bug listado tem teste que falha antes e passa depois da correção
- Fases 2–4: verificação visual das telas alteradas (dev server) antes do commit
- Migrations aplicadas via `supabase db push` antes do deploy

## Fora de escopo

- Novas funcionalidades (notificações push, pagamentos Mercado Pago, etc. — planos próprios)
- Mudança de identidade (logo, nome, paleta base)
- Refatoração de dados/queries além do necessário para as correções de regras
