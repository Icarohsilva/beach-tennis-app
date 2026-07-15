# Design: eixos de cobrança e parceiro independentes

Data: 2026-07-15

## Problema

Hoje `memberships.payment_type` é um enum **único e exclusivo**
(`subscriber` | `per_class` | `wellhub` | `totalpass`). Uma pessoa é *uma* coisa
OU outra. Isso impede cenários reais que as academias precisam:

- Mensalista que **também** tem Wellhub/TotalPass vinculado (paga mensalidade fixa
  por vaga garantida num dia **e** tem meta de check-ins pelo parceiro, gerando
  repasse a cada check-in).
- Qualquer pessoa (mensalista ou parceiro) comprar **créditos avulsos** para ir a
  aulas extras e fazer check-ins avulsos a mais.

Cenários que precisam existir (combinações, não tipos separados):
mensalista; wellhub; mensalista+wellhub; avulso; avulso+mensalista;
avulso+wellhub; avulso+mensalista+wellhub (idem TotalPass no lugar de Wellhub).

## Modelo conceitual

Dois eixos **independentes** + uma capacidade universal:

- **Eixo cobrança** (`payment_type`): `subscriber` (mensalista) ou `per_class` (avulso).
- **Eixo parceiro** (`partner`): `wellhub` | `totalpass` | `null`, com
  `monthly_checkin_target` e `wellhub_id`/`totalpass_id`.
- **Avulso/créditos**: comprar créditos e fazer check-ins avulsos é liberado para
  **todos**, independente dos eixos acima (já suportado por `credits_balance`).

Regras:
- Nunca há Wellhub **e** TotalPass ao mesmo tempo (um parceiro só).
- Os dois eixos combinam livremente (ex.: `subscriber` + `partner='wellhub'`).

## Mudança de dados (migração)

Nova migração em `supabase/migrations/`:

1. Adicionar coluna `partner checkin_partner` (nullable) em `memberships`
   (reusa o enum `checkin_partner` = `wellhub` | `totalpass`).
2. Backfill:
   ```sql
   update memberships
   set partner = payment_type::checkin_partner,
       payment_type = 'per_class'
   where payment_type in ('wellhub','totalpass');
   ```
   Quem era só-parceiro passa a ser "avulso + parceiro" (sem perda de dado; os IDs
   e a meta permanecem nas colunas existentes).
3. `payment_type` deixa de receber os valores `wellhub`/`totalpass` (passam a ser
   apenas `subscriber`/`per_class`). O enum no banco pode manter os 4 valores; o
   app simplesmente para de escrever os dois de parceiro.

Colunas inalteradas: `wellhub_id`, `totalpass_id`, `monthly_checkin_target`,
`pending_partner`, `credits_balance`.

## Mudanças de código

### Tipos (`types/index.ts`)
- `PaymentType` passa a ser tratado como `subscriber | per_class` no domínio (o
  eixo cobrança). Adicionar `partner: CheckinPartner | null` na interface
  `Membership`.

### Definir tipo do aluno (`features/checkin/actions.ts`)
- `setStudentType` deixa de ser escolha única. Vira **duas operações
  independentes** (ou um input combinado que grava os dois eixos sem um zerar o
  outro):
  - definir cobrança: `payment_type` = `subscriber` | `per_class`.
  - definir parceiro: `partner` = `null` | `wellhub` | `totalpass` (+ ID + meta).
- Ligar/mudar um eixo **não** pode limpar o outro.

### Check-in (`features/checkin/actions.ts` → `recordCheckin`)
- A verificação `profile.payment_type !== partner` (linha ~125) passa a olhar
  `profile.partner !== partner`.
- O casamento por `wellhub_id`/`totalpass_id` em `lib/checkin/ingest.ts` **não
  muda** (já casa por ID).

### Financeiro (`features/financeiro/actions.ts`, `checkoutActions.ts`)
- **Remover** o bloqueio "Alunos Wellhub/TotalPass não precisam de assinatura no
  app." Um aluno com `partner` definido **pode** assinar plano de mensalista.

### Repasse do parceiro (`features/financeiro/partnerRevenueActions.ts`)
- Filtro passa de `.in('payment_type', ['wellhub','totalpass'])` para
  "tem parceiro": `.not('partner','is',null)` (e o `partner` da linha vira a fonte
  do nome do parceiro, no lugar de `payment_type`).

### Matrícula em aula fixa (`features/aulas/adminActions.ts` → `enrollStudentInClass`)
- **Remover** a validação (linhas ~105-126) que exige plano ativo para matricular.
  Passa a permitir matrícula fixa **mesmo sem plano vinculado**.
- Garantir que `reconcileEnrollmentCredits` (concede/reserva/debita sessões) não
  quebre quando o aluno não tem plano/créditos.

### Comunidade (`features/comunidade/actions.ts`)
- O filtro por "plano" passa a considerar os dois eixos (filtrar por cobrança
  e/ou por parceiro), em vez de só `payment_type`.

### Exibição (páginas admin de alunos/grade/home/perfil)
- Onde hoje mostra um selo único de tipo, passar a mostrar **dois selos**:
  cobrança (Mensalista/Avulso) + parceiro (Wellhub/TotalPass, quando houver).

### UI de definir tipo (componente do admin que chama `setStudentType`)
- De escolha única → **dois controles independentes**:
  - Cobrança: Mensalista / Avulso.
  - Parceiro: Nenhum / Wellhub / TotalPass (+ ID do parceiro + meta mensal).

## Testes

- Atualizar testes que assumem exclusividade de `payment_type`.
- Adicionar casos das combinações novas: `subscriber`+`wellhub`,
  `per_class`+`wellhub`, `subscriber`+`totalpass`, etc.
- Cobrir: matrícula fixa sem plano; repasse do parceiro filtrando por `partner`;
  check-in olhando `partner`; financeiro permitindo plano para quem tem parceiro.

## Fora de escopo

- Booking API da Wellhub (reservas de aulas) — segue como fase futura.
- Cobrança automática da mensalidade "por fora" do app (modelo C): o app só
  precisa registrar que a pessoa é mensalista; a cobrança externa fica com a
  academia.
