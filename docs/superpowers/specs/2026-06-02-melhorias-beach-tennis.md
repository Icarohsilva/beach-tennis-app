# Melhorias e Ajustes — Beach Tennis App

**Data:** 2026-06-02  
**Status:** Aprovado para implementação

---

## Escopo

Cinco melhorias independentes agrupadas em uma sprint:

1. Limpeza de banco (dados de desenvolvimento)
2. Correção do bug "plano avulso" na lista de alunos
3. Visualização de colegas por sessão (todos os alunos autenticados)
4. Lista de espera com notificações progressivas
5. Créditos extras não-expiráveis para cancelamentos de aula fixa

---

## Item 1 — Limpeza de banco

### Objetivo
Remover todos os usuários e dados de teste, mantendo apenas o usuário admin Hudson Barros.

### Abordagem
Script manual `scripts/cleanup-db.sql` — **não é uma migration**. O desenvolvedor revisa e executa diretamente no Supabase SQL Editor.

### Conteúdo do script
1. `SELECT` de verificação listando todos os `auth.users` para conferir o que será deletado
2. `DELETE` de `auth.users` exceto o registro de Hudson Barros (filtrado por email)
3. O cascade de FK cuida de `profiles`, `enrollments`, `student_subscriptions`, `session_bookings`, `credit_transactions`, etc.
4. `DELETE` de `subscription_plans` onde `is_active = false` ou planos de teste (opcional, comentado)
5. `SELECT` final de verificação confirmando o estado pós-limpeza

### Invariantes
- Hudson Barros deve ter `role = 'admin'` em `profiles`
- O script não toca em `classes`, `class_sessions`, `system_settings` — apenas dados de usuários

---

## Item 2 — Correção do bug "plano avulso"

### Problema
Em `app/(admin)/alunos/page.tsx`, o campo "Plano" no card de cada aluno exibe o `payment_type` mapeado (`per_class` → "Avulso"), mesmo para alunos `subscriber` que têm um plano real cadastrado em `student_subscriptions`.

### Causa
A query não faz join com `student_subscriptions` nem `subscription_plans`. Exibe apenas o campo `payment_type` do `profiles`.

### Solução
Adicionar uma segunda query (ou subquery) que busca o nome do plano ativo de cada aluno:

```
student_subscriptions
  .select('student_id, plan:subscription_plans(name)')
  .in('student_id', studentIds)
  .eq('status', 'active')
```

**Lógica de exibição:**
- `payment_type = 'subscriber'` e tem plano ativo → exibe nome do plano (ex: "Plano 2x/sem")
- `payment_type = 'subscriber'` sem plano ativo → exibe "Mensalista (sem plano)"
- Demais `payment_type` → mantém label atual (Avulso, Wellhub, Totalpass)

### Arquivos afetados
- `app/(admin)/alunos/page.tsx` — query + lógica de exibição no card

---

## Item 3 — Ver colegas na aula

### Objetivo
Qualquer aluno autenticado pode ver os nomes dos participantes confirmados em qualquer sessão futura, diretamente na página de agendamento.

### Visibilidade
- Disponível para **todos os alunos autenticados**, independente de matrícula
- Apenas sessões com `status = 'scheduled'` e `session_date >= hoje`

### Dados exibidos
- Lista de nomes completos (`profiles.full_name`)
- Fonte: `session_bookings` com `status = 'confirmed'` + join em `profiles`
- Para sessões sem bookings explícitos ainda: alunos matriculados na turma via `enrollments` são listados como "confirmados por matrícula"
- Sumário: "X/Y alunos" (X = confirmados, Y = `max_students`)

### UI
- Acordeão colapsável por sessão na listagem de sessões
- Botão "Ver alunos (X)" que expande lista de nomes
- Lista simples: um nome por linha, sem avatar ou nível

### Localização
- `app/(dashboard)/agendar/page.tsx` — sessões de todas as turmas, com acordeão de colegas
- Componente reutilizável `features/aulas/SessionAttendees.tsx`

### Dados fetchados no server component
```
profiles → session_bookings (confirmed) → sessões futuras de todas as turmas
enrollments → alunos fixos das turmas (fallback quando sem bookings)
```

---

## Item 4 — Lista de espera com notificações progressivas

### Objetivo
Quando uma sessão está cheia, alunos podem entrar numa fila de espera. Ao abrir uma vaga, o sistema notifica progressivamente cada pessoa na fila com intervalo de 1 hora.

### Nova tabela: `waitlists`

```sql
create table waitlists (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  position int not null,
  status text not null default 'waiting',
    -- 'waiting'  = aguardando vaga
    -- 'offered'  = vaga oferecida, aguardando resposta (1h)
    -- 'accepted' = aluno confirmou e fez o booking
    -- 'expired'  = não respondeu em 1h, vaga passou ao próximo
    -- 'cancelled'= aluno saiu da fila voluntariamente
  joined_at timestamptz not null default now(),
  notified_at timestamptz,  -- quando a vaga foi oferecida a este aluno
  created_at timestamptz not null default now(),
  unique(session_id, student_id),
  unique(session_id, position)
);
```

**Capacidade da fila:** igual a `max_students` da turma (ex: turma de 8 → fila de 8 vagas de espera).

### Tipo TypeScript

```typescript
export interface Waitlist {
  id: string
  session_id: string
  student_id: string
  position: number
  status: 'waiting' | 'offered' | 'accepted' | 'expired' | 'cancelled'
  joined_at: string
  notified_at: string | null
  created_at: string
}
```

### Fluxo completo

**Entrar na fila:**
1. Aluno acessa sessão cheia → botão "Entrar na lista de espera"
2. Server action `joinWaitlist(sessionId)`:
   - Valida: sessão existe, está cheia, aluno não está já na fila nem tem booking
   - Calcula `position = MAX(position) + 1` para a sessão
   - Valida capacidade: `position <= max_students`
   - Insere em `waitlists` com `status = 'waiting'`

**Vaga abre (cancelamento):**
- Ao final de `cancelBooking` (após cancelar com sucesso), chamar `offerWaitlistSpot(sessionId)`
- `offerWaitlistSpot`:
  1. Busca o primeiro `waiting` da fila (`ORDER BY position ASC LIMIT 1`)
  2. Se existe: atualiza `status = 'offered'`, `notified_at = now()`
  3. Insere `notification` para o aluno: título "Vaga disponível!", corpo "Uma vaga abriu na sua aula. Você tem 1 hora para confirmar antes que passe ao próximo." com link para a sessão

**Aceitar a vaga:**
- Server action `acceptWaitlistSpot(waitlistId)`:
  1. Verifica `status = 'offered'` e `notified_at > now() - 1h`
  2. Chama `bookSession(sessionId)` internamente
  3. Se booking ok: atualiza `status = 'accepted'`
  4. Se booking falhar (alguém tomou a vaga): avança para o próximo via `offerWaitlistSpot`

**Sair da fila:**
- Server action `leaveWaitlist(waitlistId)`: atualiza `status = 'cancelled'`

### Vercel Cron: `/api/cron/waitlist-notifications`

**Frequência:** a cada 15 minutos (`*/15 * * * *`)

**Lógica:**
```
1. Busca waitlists com status = 'offered' e notified_at < now() - 1h
2. Para cada uma:
   a. Atualiza status = 'expired'
   b. Chama offerWaitlistSpot(session_id) para ofertar ao próximo
3. Retorna count de entradas processadas
```

**Configuração em `vercel.json`:**
```json
{
  "crons": [
    {
      "path": "/api/cron/waitlist-notifications",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

**Segurança:** endpoint verifica header `Authorization: Bearer ${CRON_SECRET}` (env var `CRON_SECRET`).

### UI no dashboard (página de agendamento)

- Sessão cheia: `"Lotado · Lista de espera (2/8)"` + botão "Entrar na fila"
- Aluno já na fila: `"Você está em 3º na lista de espera"` + botão "Sair da fila"
- Aluno com vaga oferecida: banner destacado `"Vaga disponível! Confirmar até HH:MM"` + botão "Confirmar presença"

### RLS
- Aluno pode ver apenas suas próprias entradas em `waitlists`
- Admin pode ver todas

---

## Item 5 — Créditos extras não-expiráveis

### Objetivo
Aluno com matrícula fixa que cancela com 5h+ de antecedência recebe um crédito que não expira enquanto o contrato estiver ativo. Pode ser usado em qualquer sessão avulsa futura.

### Comportamento atual (não muda)
- Reserva avulsa com `credit_used = true` + cancelamento com 5h+ → crédito de reposição com `expires_at = now() + 30 dias`

### Novo comportamento
- Booking com `from_enrollment = true` + `status = 'confirmed'` + cancelamento com 5h+ → crédito extra com `expires_at = null`

### Mudança em `cancelBooking` (`features/aulas/actions.ts`)

Condição adicional após o cancelamento:

```typescript
// Crédito extra para cancelamento de aula fixa
if (refundEligible && booking.from_enrollment) {
  await adminClient.from('credit_transactions').insert({
    student_id: user.id,
    type: 'refunded',
    amount: 1,
    reason: `Cancelamento de aula fixa — crédito extra (${session.session_date})`,
    session_id: booking.session_id,
    expires_at: null, // não expira
  })
  // Atualiza saldo cached
  await adminClient
    .from('profiles')
    .update({ credits_balance: profile.credits_balance + 1 })
    .eq('id', user.id)
}
// Crédito de reposição para avulso (já existe)
else if (refundEligible && booking.credit_used) {
  // ... lógica existente com expires_at = 30 dias
}
```

### Seção "Meus Créditos" no perfil do aluno

Nova seção em `app/(dashboard)/perfil/page.tsx`:
- Lista as `credit_transactions` do aluno (últimas 20, tipo `refunded` com `amount > 0`)
- Créditos com `expires_at = null` → badge "Sem vencimento" em verde
- Créditos com `expires_at` → "Expira em DD/MM/AAAA"
- Saldo total destacado no topo

---

## Arquivos a criar/modificar

| Arquivo | Ação | Item |
|---|---|---|
| `scripts/cleanup-db.sql` | Criar | 1 |
| `app/(admin)/alunos/page.tsx` | Modificar | 2 |
| `features/aulas/SessionAttendees.tsx` | Criar | 3 |
| `app/(dashboard)/agendar/page.tsx` | Modificar | 3 |
| `supabase/migrations/006_waitlists.sql` | Criar | 4 |
| `types/index.ts` | Modificar | 4 |
| `features/aulas/actions.ts` | Modificar | 4, 5 |
| `features/aulas/waitlistActions.ts` | Criar | 4 |
| `app/api/cron/waitlist-notifications/route.ts` | Criar | 4 |
| `vercel.json` | Criar/modificar | 4 |
| `app/(dashboard)/perfil/page.tsx` | Modificar | 5 |

---

## Ordem de implementação recomendada

1. Item 1 (script cleanup — independente, pode rodar antes de qualquer código)
2. Item 2 (bug fix simples — 1 arquivo)
3. Item 5 (créditos extras — 2 arquivos, lógica pequena)
4. Item 3 (ver colegas — componente novo, sem migration)
5. Item 4 (lista de espera — migration + maior volume de código)
