# Receita de check-in de parceiro + autoatendimento de ID — Design

**Data:** 2026-06-26
**Branch:** develop

## Contexto

A integração de check-in Wellhub/TotalPass já existe: `memberships` guarda por-academia
`payment_type` (`subscriber` | `per_class` | `wellhub` | `totalpass`), `wellhub_id`,
`totalpass_id`, `monthly_checkin_target` e `pending_partner`. Os check-ins ficam em
`checkins` (com `checkin_date` e `organization_id`). O progresso mensal já é contado pela
janela de mês corrente (`lib/utils/monthWindow.ts → getMonthWindow`).

Hoje faltam três coisas, levantadas pelo dono da academia:

1. **O aluno não consegue informar o próprio ID de parceiro depois do cadastro** — só o
   admin define, na ficha do aluno.
2. **Dependentes não têm um fluxo claro de tipo de pagamento** — embora já apareçam na
   lista de alunos e tenham membership própria.
3. **Check-in de parceiro não vira receita** — o Financeiro só soma a tabela `payments`.
   Falta atribuir um valor por check-in (Wellhub/TotalPass) e somar no Financeiro.

Este design cobre as três como um único plano.

## Decisões tomadas (com o usuário)

- **Receita = por check-in, com teto na meta.** Para cada aluno de parceiro:
  `min(check-ins do mês, meta mensal) × valor do parceiro`. Soma de todos os alunos = receita
  de parceiro do mês, rotulada como "A receber (mês seguinte)".
- **Valor por check-in é da academia** (um valor para Wellhub, outro para TotalPass), não
  por aluno. A meta de quantidade continua por aluno.
- **Cálculo na hora** (sem tabela de lançamentos, sem cron). O Financeiro calcula ao abrir a
  tela; um botão "Recalcular" reexecuta a partir dos check-ins já feitos.
- **Auto-atendimento vale na hora**, mas **travado se o aluno já for mensalista ativo**
  (assinatura `student_subscriptions` com `status='active'`).
- **Valores guardados em tabela nova `partner_checkin_rates`** (desacoplada de a integração
  estar conectada).
- **Renovação mensal é automática** pela janela de mês: a meta é fixa; o que zera no dia 1º
  é a contagem, porque toda leitura conta só o mês corrente via `getMonthWindow`.

## Unidades de valor

Para casar com o card de receita do Financeiro (`Intl.NumberFormat('pt-BR', BRL)` aplicado
direto sobre `payments.amount`), **`partner_checkin_rates.value` é em reais**
(`numeric(10,2)`, ex.: `10.00` = R$10 por check-in) e o total calculado também é em reais.
Nada de centavos aqui.

---

## Feature 1 — Aluno define o próprio ID de parceiro

**Onde:** nova seção "Acesso por parceiro" em `app/(dashboard)/perfil/page.tsx`, renderizada
para o aluno logado (não para dependentes; ver F2). Componente client novo
`features/checkin/SelfPartnerForm.tsx`.

**UI:** seletor (Wellhub / TotalPass) + input de ID + botão "Salvar". Mostra o vínculo atual
se já houver. Pré-preenche com o `payment_type`/ID atuais da membership.

**Server action:** `features/checkin/actions.ts → selfSetPartnerId(partner, partnerId)`.
- NÃO é admin-only. Usa o usuário logado + academia ativa (`getActiveOrgId`).
- **Trava:** se existir `student_subscriptions` com `student_id = user.id`,
  `organization_id = orgId`, `status='active'` → retorna
  `{ error: 'Você tem um plano mensalista ativo. Fale com o professor para mudar para parceiro.' }`.
- Valida `partner ∈ {wellhub, totalpass}` e `partnerId` não vazio (trim).
- Grava na membership da academia ativa (via `createAdminClient`, filtrando
  `user_id = user.id` e `organization_id = orgId`):
  `payment_type = partner`, `wellhub_id`/`totalpass_id = partnerId` (a coluna do parceiro
  escolhido), `pending_partner = null`. **Não** mexe em `monthly_checkin_target` (segue com o
  professor; default 0).
- `revalidatePath('/perfil')`.

**Critério de aceite:** aluno mensalista ativo é bloqueado; aluno comum salva e o
`payment_type`/ID aparecem na hora.

---

## Feature 2 — Dependente com tipo de pagamento próprio

**Situação atual (verificada):** dependentes já aparecem em `/admin/alunos` (a query de
`memberships` filtra só `role='student'`, sem excluir `is_dependent`) e já linkam para
`/admin/alunos/[id]`, cuja `StudentProfileClient` **já** renderiza a seção "Tipo de aluno"
(mensalista/Wellhub/TotalPass + ID + meta) independente de `is_dependent`. O `setStudentType`
já grava na membership do dependente.

**Logo, F2 é principalmente garantia/verificação, não construção nova:**
- Confirmar que a ficha do dependente abre e permite definir tipo + ID + meta (via teste
  manual no roteiro).
- Garantir que o cálculo de receita (F3) **itere sobre todas as memberships de parceiro,
  incluindo dependentes** — ou seja, NÃO filtrar por `is_dependent`. Esse é o único ponto que
  poderia deixar o dependente "de fora do financeiro".
- Sem mudança de schema.

**Critério de aceite:** um dependente definido como Wellhub/TotalPass com meta > 0 e
check-ins no mês entra no total "A receber" do Financeiro igual a um aluno normal.

---

## Feature 3 — Receita de check-in de parceiro no Financeiro

### 3.1 Schema — `partner_checkin_rates`

Migration nova `supabase/migrations/2026XXXXXXXXXX_partner_checkin_rates.sql`:

```sql
create table if not exists partner_checkin_rates (
  organization_id uuid not null references organizations(id) on delete cascade,
  partner         checkin_partner not null,
  value           numeric(10,2) not null default 0, -- reais por check-in
  updated_at      timestamptz not null default now(),
  primary key (organization_id, partner)
);

alter table partner_checkin_rates enable row level security;

-- Leitura: admin da própria academia. Escrita: service role (admin actions).
create policy "partner_rates_admin_org" on partner_checkin_rates
  for select using (is_org_admin(organization_id));
```

Tipo novo em `types/index.ts`:
```ts
export interface PartnerCheckinRate {
  organization_id: string
  partner: CheckinPartner
  value: number
  updated_at: string
}
```

### 3.2 Lógica pura — `lib/checkin/partnerRevenue.ts`

```ts
import type { CheckinPartner } from '@/types'

export interface PartnerStudentMonth {
  partner: CheckinPartner
  checkinsThisMonth: number
  monthlyTarget: number
}
export type PartnerRates = Record<CheckinPartner, number> // reais por check-in

export interface PartnerRevenue {
  total: number                              // soma em reais
  perPartner: Record<CheckinPartner, number> // subtotal por parceiro
}

// Receita = Σ min(check-ins do mês, meta) × valor do parceiro.
// Meta 0 ⇒ contribuição 0 (teto na meta). Negativos saneados para 0.
export function computePartnerRevenue(
  students: PartnerStudentMonth[],
  rates: PartnerRates,
): PartnerRevenue { /* ... */ }
```

Testes Vitest (`lib/checkin/partnerRevenue.test.ts`):
- Lista vazia → total 0.
- Teto na meta: 15 check-ins, meta 12, valor 10 → 120 (não 150).
- Abaixo da meta: 5 check-ins, meta 12, valor 10 → 50.
- Meta 0 → 0 mesmo com check-ins.
- Mistura Wellhub + TotalPass → `perPartner` e `total` corretos.

### 3.3 Server actions — `features/financeiro/partnerRevenueActions.ts`

- `getPartnerCheckinRates(): Promise<PartnerRates>` — admin-only; lê `partner_checkin_rates`
  da academia ativa, default 0 para parceiro sem linha.
- `setPartnerCheckinRate(partner, value): Promise<{ error? }>` — admin-only (`requireOwner`);
  valida `value >= 0`; `upsert` em `partner_checkin_rates` (onConflict
  `organization_id,partner`); `revalidatePath('/admin/financeiro')`.
- `getPartnerRevenueThisMonth(): Promise<{ total; perPartner }>` — admin-only. Carrega
  memberships de parceiro da academia (`payment_type in ('wellhub','totalpass')`, **sem**
  filtrar `is_dependent`); para cada uma conta os check-ins do mês corrente
  (`getMonthWindow`, `eq organization_id`, `eq student_id`, `gte/lte checkin_date`); monta
  `PartnerStudentMonth[]`; chama `computePartnerRevenue` com as rates atuais.

### 3.4 UI no Financeiro

Em `app/(admin)/admin/financeiro/page.tsx`, na área de Planos, nova seção
"Parceiros (Wellhub/TotalPass)" via componente client novo
`app/(admin)/admin/financeiro/PartnerRevenueCard.tsx`:
- Dois inputs (valor por check-in Wellhub, valor por check-in TotalPass) + "Salvar valores"
  → `setPartnerCheckinRate`.
- Card "A receber (mês seguinte)" com o total e o detalhe por parceiro.
- Botão "Recalcular" → reexecuta `getPartnerRevenueThisMonth` e atualiza o card.
- Aviso quando há aluno de parceiro com `monthly_target = 0` (não soma) — orienta a definir a
  meta na ficha.

**Critério de aceite:** com valores definidos e alunos de parceiro com meta e check-ins, o
card mostra o total correto; "Recalcular" reflete check-ins feitos depois de abrir a tela; no
dia 1º o total recomeça do zero (janela de mês).

---

## Renovação mensal (transversal)

Não há cron nem reset. A meta (`monthly_checkin_target`) é um valor fixo por aluno; o que
renova no dia 1º é a **contagem**, porque todas as leituras contam só o mês corrente via
`getMonthWindow`. Critério de aceite: card do aluno (`home`/`perfil`), ficha do admin e o
cálculo de receita usam a MESMA janela de mês.

**Observação de fuso (fora de escopo):** `checkin_date` é gravado em data do servidor (UTC).
Um check-in tarde da noite do último dia do mês (Brasília) pode cair no dia 1º seguinte. Isso
é o comportamento atual do app e não muda aqui; tratar fuso de Brasília no boundary do mês é
item separado.

---

## Arquivos

**Novos:**
- `supabase/migrations/2026XXXXXXXXXX_partner_checkin_rates.sql`
- `lib/checkin/partnerRevenue.ts` + `lib/checkin/partnerRevenue.test.ts`
- `features/financeiro/partnerRevenueActions.ts`
- `features/checkin/SelfPartnerForm.tsx`
- `app/(admin)/admin/financeiro/PartnerRevenueCard.tsx`

**Modificados:**
- `types/index.ts` — `PartnerCheckinRate`.
- `features/checkin/actions.ts` — `selfSetPartnerId`.
- `app/(dashboard)/perfil/page.tsx` — seção "Acesso por parceiro".
- `app/(admin)/admin/financeiro/page.tsx` — render do `PartnerRevenueCard` + carga de rates e
  receita.

## Verificação (ponta a ponta)

1. `npm run test:run` — inclui `partnerRevenue.test.ts`.
2. `npm run build` — sem erro de tipo.
3. **F1:** logar como aluno comum, definir Wellhub + ID no perfil → aplica na hora. Logar como
   mensalista ativo → bloqueado com mensagem.
4. **F2:** abrir a ficha de um dependente, defini-lo como TotalPass com meta → aparece na
   receita do Financeiro.
5. **F3:** definir valores Wellhub/TotalPass, registrar check-ins, conferir o card "A receber"
   e o botão "Recalcular".
6. Migration aplicada manualmente pelo usuário (SQL Editor) antes do deploy de produção.

## Fora de escopo

- Geração de linhas em `payments`/ledger contábil para a receita de parceiro (cálculo é na
  hora).
- Snapshot/fechamento mensal histórico (pode vir depois).
- Tratamento de fuso de Brasília no boundary do mês.
- Valores por aluno ou planos de parceiro com tiers (decidido: valor único por academia).
