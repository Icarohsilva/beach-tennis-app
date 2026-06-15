# Check-in Wellhub/TotalPass

**Data:** 2026-06-15
**Status:** Design aprovado (aguardando revisão do spec)

## Problema

Hoje o app tem apenas o "esqueleto" de Wellhub/TotalPass no banco (`profiles.payment_type`, `wellhub_id`, `totalpass_id`) e **nenhuma funcionalidade**: não há tela para vincular um aluno a esses parceiros, não há integração/webhook, e a presença é sempre `source: 'manual'`.

Os alunos Wellhub/TotalPass têm uma **meta mensal de check-ins** (o parceiro paga por visita). Esses check-ins acontecem:
- numa **aula fixa** do aluno (confirmando presença), ou
- em **qualquer outro dia** (sem aula), só para adiantar/quitar a meta do mês.

Check-in pode ser feito a qualquer hora, pelo próprio aluno (futuro) e pelo admin.

## Decisões (confirmadas com o usuário)

- **Acesso:** parceiro com API, mas **formato ainda desconhecido** → camada de adaptador.
- **Fluxo:** self-service (app do aluno) **e** admin. Self-service fica no follow-up.
- **Reserva × check-in:** em dia de aula, reserva antes e o check-in confirma presença. Check-in também vale em dias sem aula (avulso, só conta na meta).
- **Janela:** sem restrição de horário.
- **Meta mensal:** número fixo por aluno, definido pelo admin.
- **Créditos:** Wellhub/TotalPass **não** usam crédito (mantém comportamento atual).

## Escopo

**Nesta entrega:** vínculo do aluno (payment_type + ID do parceiro + meta mensal), modelo de dados de check-in, registro de check-in com **validação manual/admin**, ligação com presença em aula fixa, painel de progresso (feitos × faltantes), e a **interface de adaptador** com um validador stub.

**Fora (follow-up isolado):** adaptadores reais Wellhub/TotalPass (pull por código ou push por webhook) e a tela self-service do aluno. A `action` de registro é compartilhada, então o follow-up é uma troca localizada.

## Arquitetura

Princípio central: a regra de check-in nunca fala com a API do parceiro direto — sempre passa por `CheckinValidator`. Isso permite construir tudo agora com um validador manual e plugar a integração real depois sem refatorar.

### 1. Modelo de dados

**Migration** em `supabase/migrations/` (timestamp novo):

- Novo enum `checkin_partner` (`wellhub`, `totalpass`).
- Nova tabela `checkins`:

| campo | tipo | nota |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `student_id` | uuid not null → profiles(id) on delete cascade | |
| `partner` | checkin_partner not null | de qual parceiro |
| `checkin_date` | date not null | dia da visita |
| `session_id` | uuid null → class_sessions(id) on delete set null | preenchido quando cai em aula fixa |
| `external_ref` | text null | código/transação do parceiro (auditoria/dedupe) |
| `validation` | text not null default 'manual' | `manual` agora; `wellhub`/`totalpass` no futuro |
| `created_by` | uuid null → profiles(id) on delete set null | admin ou o próprio aluno |
| `created_at` | timestamptz not null default now() | |

- Índice `(student_id, checkin_date)` para a contagem mensal.
- Índice único parcial `unique (partner, external_ref) where external_ref is not null` — dedupe quando há referência do parceiro.
- `profiles`: adicionar `monthly_checkin_target int not null default 0`.
- RLS: seguindo o padrão do projeto, escrita via `createAdminClient()` (service role). Leitura do próprio aluno permitida; detalhes na migration espelhando as policies existentes de `attendance`/`session_bookings`.

### 2. Camada de adaptador (validação)

`lib/checkin/validator.ts`:

```ts
export type CheckinPartner = 'wellhub' | 'totalpass'

export interface CheckinValidationInput {
  partner: CheckinPartner
  studentId: string
  partnerMemberId: string | null   // wellhub_id / totalpass_id do perfil
  code?: string                    // código do app do parceiro (futuro)
}

export interface CheckinValidationResult {
  valid: boolean
  externalRef?: string             // id/transação retornada pelo parceiro
  validation: 'manual' | CheckinPartner
  error?: string
}

export interface CheckinValidator {
  validate(input: CheckinValidationInput): Promise<CheckinValidationResult>
}
```

- `manualValidator`: retorna `{ valid: true, validation: 'manual', externalRef: input.code ?? undefined }`. É o usado agora.
- `getValidator(partner)`: registry. Hoje devolve o `manualValidator` para ambos; no follow-up devolve `wellhubValidator`/`totalpassValidator`.

Pura o suficiente para teste unitário (o manual não toca em rede).

### 3. Regra de negócio — `recordCheckin`

`features/checkin/actions.ts` (server action, usa `createAdminClient()`):

```
recordCheckin(studentId, partner, opts?: { date?, code?, createdBy? }) -> { error?, progress? }
```

1. Busca o perfil; valida `payment_type === partner` (aluno precisa estar vinculado àquele parceiro). Senão → erro.
2. `getValidator(partner).validate({ partner, studentId, partnerMemberId, code })`. Se `!valid` → erro com o motivo.
3. Se `externalRef` veio e já existe `checkins` com `(partner, external_ref)` → idempotente: não duplica, retorna o progresso atual.
4. Insere a linha em `checkins` (`checkin_date` = `opts.date ?? hoje`, `validation` do resultado, `created_by`).
5. **Ligação com presença:** se em `checkin_date` existe `class_sessions` (status scheduled) de uma turma em que o aluno tem matrícula ativa e `session_bookings` confirmado, faz upsert em `attendance` (`status='present'`, `source=partner`) e grava esse `session_id` no check-in.
6. Retorna `progress` (ver seção 4).

### 4. Progresso mensal (puro)

`lib/checkin/progress.ts`:

```ts
export interface CheckinProgress { target: number; done: number; remaining: number; ahead: number }
export function computeProgress(target: number, doneThisMonth: number): CheckinProgress
// remaining = max(target - done, 0); ahead = max(done - target, 0)
```

`done` = nº de `checkins` do aluno no mês corrente (`checkin_date` na janela do mês — reusa `getMonthWindow`). Testável isoladamente.

### 5. Telas

**Admin → perfil do aluno** ([StudentProfileClient.tsx](../../../app/(admin)/admin/alunos/[id]/StudentProfileClient.tsx)):

- **Vincular parceiro:** definir `payment_type` para `wellhub`/`totalpass`, campo do ID do parceiro (`wellhub_id`/`totalpass_id`) e a **meta mensal** (`monthly_checkin_target`). Nova action `setStudentPartner(studentId, { paymentType, partnerId, monthlyTarget })`.
- **Check-ins do mês:** progresso (feitos × faltantes), lista dos check-ins do mês, e botão **Registrar check-in** (admin) que chama `recordCheckin` com `validation: 'manual'`.

**Self-service do aluno:** follow-up (depende do formato da API). A action `recordCheckin` já fica pronta para ser reusada.

Componentes seguem `components/ui/` (Button, Card, Badge, Input).

### 6. Erros

- Aluno não vinculado ao parceiro (`payment_type` diferente) → erro claro.
- Validação inválida → erro com o motivo do validador.
- `external_ref` duplicado → idempotente (retorna progresso, não duplica).
- Falha de insert → erro genérico, sem registrar presença.

### 7. Testes

- **Puros (Vitest):** `computeProgress` (abaixo, em cima, na meta); `manualValidator` (sempre válido, propaga código).
- **Regra `recordCheckin`:** verificação com client mockado/manual cobrindo: aluno não vinculado → erro; check-in avulso (sem aula) → cria `checkins`, sem `attendance`; check-in em dia de aula fixa com reserva → cria `checkins` + `attendance` source=partner; idempotência por `external_ref`.

## Fora de escopo

- Adaptadores reais Wellhub/TotalPass (pull/push) — follow-up.
- Tela self-service do aluno — follow-up.
- Conciliação financeira/repasse do parceiro (apenas registro de check-ins).
- Restrição de janela de horário (decisão: sem restrição).
