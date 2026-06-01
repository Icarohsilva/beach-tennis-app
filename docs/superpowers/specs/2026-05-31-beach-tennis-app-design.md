# Beach Tennis App — Design Spec
**Data:** 2026-05-31  
**Admin:** Hudson Barros  
**Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Supabase · next-pwa · Vercel

---

## 1. Visão Geral

Sistema de gestão de academia de beach tennis. O núcleo é o controle de aulas e presença. Módulos secundários: financeiro/assinaturas, comunidade social e torneios.

**Acesso:** PWA instalável via navegador (sem app store). Deploy na Vercel. Funciona em qualquer OS/browser.

---

## 2. Perfis de Usuário

| Perfil | Descrição |
|---|---|
| **Admin** | Hudson Barros — acesso total ao sistema |
| **Aluno regular** | Faz cadastro, agenda aulas, paga plano ou avulso |
| **Responsável** | Adulto com conta principal; adiciona filhos como dependentes; paga pelos planos dos filhos |
| **Dependente (Kids)** | Vinculado a um responsável; sem limite de dependentes por conta |
| **Wellhub** | Acessa via benefício Wellhub; check-in automático via webhook |
| **TotalPass** | Acessa via benefício TotalPass; check-in automático via webhook |

---

## 3. Arquitetura

**Abordagem:** Feature-based dentro do App Router. Cada módulo (aulas, financeiro, comunidade, torneios) é uma feature folder isolada. Rotas, componentes e lógica de negócio co-localizados por domínio.

### Estrutura de Pastas

```
/app
  /(auth)/          → login · cadastro · recuperação de senha
  /(dashboard)/     → layout autenticado (aluno)
    /home/
    /aulas/
    /agendar/
    /comunidade/
    /perfil/
    /torneios/       → acessado via Home, não no bottom nav
  /(admin)/         → layout admin (Hudson)
    /dashboard/
    /alunos/
    /grade/
    /financeiro/
    /notificacoes/
    /torneios/
  /api/             → webhooks: mercadopago · wellhub · totalpass · webpush

/features/
  /aulas/           → ClassCard · SessionList · BookingForm · AttendanceSheet
  /financeiro/      → SubscriptionCard · PaymentHistory · PlanSelector
  /comunidade/      → PostFeed · PostCard · CreatePost · CommentList
  /torneios/        → TournamentCard · BracketView · MatchResult

/components/
  /ui/              → Button · Card · Badge · Input · Modal · BottomNav
  /layout/          → Navbar · AdminSidebar · KidsHighlight

/lib/
  /supabase/        → client.ts · server.ts · middleware.ts
  /hooks/           → useCredits · useSession · useNotifications
  /utils/           → levelAccess · creditRules · dateHelpers

/types/
  index.ts          → tipos globais TypeScript
```

### Fluxo de Dados

```
Client Component → Server Action / Server Component → Supabase RLS → PostgreSQL
```

Server Components buscam dados direto no Supabase. Client Components usam hooks para interatividade em tempo real (Supabase Realtime).

**Proteção de rotas:** `middleware.ts` intercepta todas as rotas → verifica sessão Supabase → redireciona por role:
- `/(dashboard)/*` → autenticado
- `/(admin)/*` → role = admin

---

## 4. Modelo de Dados

### Tabelas Núcleo

**profiles**
```
id              uuid PK → auth.users
full_name       text
avatar_url      text
phone           text
city            text
role            enum: student | admin
level           enum: A | B | C | D | iniciante
payment_type    enum: subscriber | per_class | wellhub | totalpass
is_dependent    boolean default false
parent_id       uuid FK → profiles (nullable — para dependentes/kids)
contract_active boolean default true
credits_balance int     -- valor cacheado; fonte da verdade é credit_transactions
wellhub_id      text (nullable)
totalpass_id    text (nullable)
created_at      timestamptz
```

**classes** — grade fixa de turmas
```
id              uuid PK
name            text
description     text
level           enum: A | B | C | D | iniciante
type            enum: kids | adult
day_of_week     int (0=domingo, 6=sábado)
start_time      time
end_time        time
max_students    int
is_active       boolean
```

**class_sessions** — instâncias específicas por data
```
id              uuid PK
class_id        uuid FK → classes
session_date    date
status          enum: scheduled | completed | cancelled
notes           text
```

### Tabelas de Agendamento

**enrollments** — horário fixo do aluno
```
id              uuid PK
student_id      uuid FK → profiles
class_id        uuid FK → classes
enrolled_at     timestamptz
cancelled_at    timestamptz (nullable)
is_active       boolean
```

**session_bookings** — todas as inscrições em sessões (fixas auto-geradas, avulsas e reposições)
```
id              uuid PK
student_id      uuid FK → profiles
session_id      uuid FK → class_sessions
type            enum: extra | makeup
status          enum: confirmed | cancelled
from_enrollment boolean default false  — true = gerado automaticamente do dia fixo
credit_used     boolean
booked_at       timestamptz
cancelled_at    timestamptz (nullable)
```

**attendance** — registro de presença
```
id              uuid PK
student_id      uuid FK → profiles
session_id      uuid FK → class_sessions
status          enum: present | absent | late
source          enum: manual | wellhub | totalpass
checked_in_at   timestamptz
```

**credit_transactions** — histórico completo de créditos
```
id              uuid PK
student_id      uuid FK → profiles
type            enum: renewed | used | refunded | expired
amount          int
reason          text
session_id      uuid FK → class_sessions (nullable)
subscription_id uuid FK → student_subscriptions (nullable)
expires_at      timestamptz (nullable — null = expira virada do mês; data = crédito reposição 30 dias)
created_at      timestamptz
```

**trial_bookings** — aula experimental (sem login obrigatório)
```
id              uuid PK
name            text
email           text
phone           text
session_id      uuid FK → class_sessions
status          enum: pending | attended | no_show | cancelled
must_pay_next   boolean default false
created_at      timestamptz
```

### Tabelas Financeiras

**subscription_plans** — planos configuráveis pelo admin
```
id                  uuid PK
name                text
description         text
classes_per_week    int
credits_per_month   int
price_monthly       numeric (mockado: R$ 0,00 até confirmação)
price_quarterly     numeric
price_annual        numeric
is_active           boolean
```

**student_subscriptions** — assinatura ativa por aluno
```
id                      uuid PK
student_id              uuid FK → profiles (quem usa)
payer_id                uuid FK → profiles (quem paga — pode ser responsável)
plan_id                 uuid FK → subscription_plans
status                  enum: active | paused | cancelled
starts_at               timestamptz
ends_at                 timestamptz (nullable)
next_billing_at         timestamptz
discount_pct            numeric default 0
gateway_subscription_id text (Mercado Pago)
```

**payments** — histórico de pagamentos
```
id                  uuid PK
student_id          uuid FK → profiles
subscription_id     uuid FK → student_subscriptions (nullable)
session_id          uuid FK → class_sessions (nullable — aula avulsa)
amount              numeric
currency            text default 'BRL'
status              enum: pending | paid | failed | refunded
type                enum: subscription | per_class | trial
gateway_payment_id  text
gateway             text default 'mercadopago'
paid_at             timestamptz (nullable)
created_at          timestamptz
```

**system_settings** — configurações do admin
```
key     text PK (ex: 'credit_expiry_days', 'cancellation_window_hours')
value   text
updated_at timestamptz
updated_by uuid FK → profiles
```

### Tabelas de Integrações

**wellhub_checkins**
```
id                  uuid PK
wellhub_user_id     text
wellhub_member_id   text
student_id          uuid FK → profiles (nullable — antes do match)
session_id          uuid FK → class_sessions (nullable)
status              enum: matched | unmatched | auto_confirmed
raw_payload         jsonb
checked_in_at       timestamptz
```

**totalpass_checkins** — mesma estrutura com totalpass_user_id

### Tabelas de Torneios

**tournaments**
```
id          uuid PK
name        text
date        date
format      enum: super8
modality    enum: dupla_fixa | dupla_revezando
level       enum: A | B | C | D | iniciante
status      enum: draft | open | in_progress | finished
created_by  uuid FK → profiles
```

**tournament_matches**
```
id              uuid PK
tournament_id   uuid FK → tournaments
player1_id      uuid FK → profiles
player2_id      uuid FK → profiles
partner1_id     uuid FK → profiles (nullable — dupla fixa)
partner2_id     uuid FK → profiles (nullable)
score           text
winner_id       uuid FK → profiles (nullable)
round           int
played_at       timestamptz
```

### Tabelas Sociais

**posts**
```
id              uuid PK
author_id       uuid FK → profiles
content         text
image_urls      text[]
likes_count     int default 0
session_id      uuid FK → class_sessions (nullable — marcar treino)
tournament_id   uuid FK → tournaments (nullable)
created_at      timestamptz
```

**post_likes** — post_id + user_id (PK composta)

**post_comments**
```
id          uuid PK
post_id     uuid FK → posts
author_id   uuid FK → profiles
content     text
created_at  timestamptz
```

**notifications**
```
id          uuid PK
user_id     uuid FK → profiles
type        text (class_reminder | payment | promotion | event | tournament)
title       text
body        text
read        boolean default false
created_at  timestamptz
```

---

## 5. Regras de Negócio

### Horários
- Segunda a sexta: 7h–22h
- Sábado: 7h–11h (ou 12h — confirmar com Hudson)
- Fora desses horários não é possível agendar

### Níveis e Acesso
- Hierarquia: **A > B > C > D > Iniciante** (A = mais avançado)
- Regra: aluno pode fazer aula no **seu nível ou abaixo** (ex: nível C → pode ir em C, D, Iniciante)
- Implementado em RLS policy + Server Action antes de inserir `session_bookings`

### Aulas Kids
- Flag `type: kids` na tabela `classes`
- Destaque visual no card (badge + borda diferenciada)
- Adultos não podem confirmar booking em turmas kids (validação backend)
- Crianças precisam de conta responsável vinculada (`parent_id`)

### Agendamento
- Máximo **2 aulas/dia** via app por aluno (exceção: presença física na quadra, fora do controle do app)
- Alunos com dia fixo (`enrollments`) são **auto-agendados** no início de cada mês via cron (Supabase pg_cron)

### Cancelamento e Créditos

**Cancelamento:**
- ≥5h antes: cancelamento sem penalidade → ganha **1 crédito de reposição** (válido 30 dias, configurável em `system_settings.credit_expiry_days`)
- <5h antes: perde a aula, sem crédito

**Créditos mensais:**
- Renovados (não acumulados) no início de cada mês para o limite do plano
- Créditos não usados do mês anterior são perdidos
- Nunca ultrapassam o limite mensal do plano

**Créditos de reposição:**
- Válidos por 30 dias corridos (padrão, configurável pelo admin)
- Usados para aulas avulsas (`session_bookings.type = makeup`)
- Expiram ao cancelar contrato

### Aula Experimental
- Sem login obrigatório — nome, email, telefone
- Gratuita na primeira vez
- No-show sem cancelar ≥5h antes → `must_pay_next = true` → próxima experimental requer pagamento antes da confirmação

### Mensalista com Dia Fixo
```
1. Admin cria enrollment fixo para o aluno
2. pg_cron (dia 1 de cada mês):
   a. Aloca créditos mensais (renova até o limite do plano)
   b. Gera session_bookings automáticos para todas as sessões do mês
   c. Desconta créditos de cada sessão agendada
3. Mercado Pago processa cobrança recorrente
4. Webhook confirma pagamento → créditos liberados
```

### Responsáveis e Dependentes
- Sem limite de dependentes por responsável
- Responsável pode assinar plano para o filho sem ter plano igual
- `student_subscriptions.payer_id` = responsável; `student_id` = filho
- Créditos alocados na conta do filho

---

## 6. Navegação (Mobile-first)

### Bottom Navigation — Aluno
```
🏠 Home | 📅 Aulas | [+ Agendar] | 🤝 Comunidade | 👤 Perfil
```
- Botão "+" flutuante central para agendar
- Torneios acessível via card na Home ("Próximos torneios → ver todos")

### Telas por Contexto

**Público (sem login):**
- Landing page (sobre a academia, horários, níveis, CTA)
- Aula Experimental (form sem login)
- Login / Cadastro

**Aluno:**
- Home — próximas aulas, saldo créditos, card torneios, notificações
- Minhas Aulas — grade fixa + avulsas, cancelar (regra 5h), histórico
- Agendar — turmas disponíveis, filtro nível/dia, badge kids, limite 2/dia
- Comunidade — feed posts, criar post com foto, curtir, comentar
- Torneios — lista, inscrição, chave Super 8, resultados
- Perfil — dados pessoais, plano ativo, histórico pagamentos, créditos, assinar plano

**Admin:**
- Dashboard — alunos ativos, receita, aulas hoje, inadimplentes, experimentais pendentes
- Alunos — lista, busca, perfil individual, definir dias fixos, alterar nível, gerenciar dependentes
- Grade de Aulas — criar/editar turmas, ver presença por sessão, marcar presença manual
- Financeiro — receita, pagamentos pendentes, inadimplentes, gerenciar planos, descontos individuais
- Notificações — enviar push/email/WhatsApp para todos ou grupos filtrados
- Torneios — criar Super 8, inscrições, lançar resultados

---

## 7. Notificações

### Canais
| Canal | Ferramenta | Casos de uso |
|---|---|---|
| **Push (PWA)** | Web Push API | Lembrete de aula no dia, confirmação de agendamento, vaga disponível |
| **Email** | Resend | Confirmação de pagamento, lembrete de aula, promoções, eventos, torneios |
| **WhatsApp** | Z-API ou Evolution API (número Business do Hudson) | Promoções, aulas extras, eventos, torneios |

### Envio Admin
- Destinatários: todos / filtrado por nível / por tipo de plano / por alunos com PWA instalado
- Agendamento de envio
- Tipos: lembrete, promoção, aula extra, evento, torneio

---

## 8. Integrações

| Sistema | Mecanismo | Fluxo |
|---|---|---|
| **Mercado Pago** | Webhook POST `/api/webhooks/mercadopago` | Recebe evento → atualiza `payments.status` → libera créditos mensais |
| **Wellhub** | Webhook POST `/api/webhooks/wellhub` | Match por `profiles.wellhub_id` → cria `attendance` com `source=wellhub` → auto-confirma |
| **TotalPass** | Webhook POST `/api/webhooks/totalpass` | Idem via `profiles.totalpass_id` |
| **Resend** | SDK server-side | Disparado por Server Actions e cron jobs |
| **Z-API / Evolution API** | REST API | Disparado pelo painel admin de notificações |

Wellhub/TotalPass primeiro acesso: app detecta ID externo sem match → solicita cadastro básico → vincula ao perfil.

---

## 9. PWA e Deploy

**PWA (next-pwa):**
- Service worker com cache offline para telas principais
- `manifest.json`: tema laranja (`#ea580c`), `display: standalone`, ícone da academia
- Prompt "Adicionar à tela inicial" (nativo Android, via Safari no iOS)
- Funciona em qualquer navegador/OS sem app store

**Deploy:**
- Plataforma: **Vercel**
- Variáveis de ambiente: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`, `ZAPI_TOKEN`
- Preview deploys por branch via Vercel

---

## 10. Valores Mockados (pendente confirmação com Hudson)

Os seguintes valores devem ser configurados pelo admin após a confirmação:
- Preços de planos (mensalidade, avulso, experimental)
- Preço por billing cycle (mensal/trimestral/anual)
- `credit_expiry_days` (padrão: 30)
- `cancellation_window_hours` (padrão: 5)
- Horário de encerramento do sábado (11h ou 12h)
- Gateway de WhatsApp (Z-API ou Evolution API)

---

## 11. Decisões Pendentes

- [ ] Gateway WhatsApp: Z-API vs Evolution API (confirmar com Hudson qual número Business ele vai usar)
- [ ] Gateway pagamento: Mercado Pago a confirmar com Hudson (qual banco/conta ele tem)
- [ ] Valores de planos e aulas avulsas
- [ ] Horário de encerramento sábado (11h ou 12h)
