# Tournament Payment & Discount Design

## Goal

Adicionar cobrança de inscrição por PIX (confirmação manual pelo admin) e desconto progressivo para quem se inscreve em mais de um torneio na mesma semana. Resolver também o bloqueio de cadastro para jogadores externos que chegam via link público.

---

## Contexto atual

- Inscrição via `/t/[id]` usa `registerExternal()` — insere direto em `tournament_entries` sem nenhuma checagem de pagamento.
- Cadastro de nova conta (`/cadastro`) exige código de convite da academia — bloqueia jogadores externos que não têm vínculo com nenhuma academia.
- Não existe campo de preço, chave PIX, status de pagamento nem lógica de desconto.

---

## Modelo de dados

### `tournaments` — novas colunas

```sql
entry_price_cents  integer   -- nullable; null ou 0 = gratuito
pix_key            text      -- nullable; se null = gratuito mesmo com preço
```

Regra: torneio é **pago** somente quando `entry_price_cents > 0 AND pix_key IS NOT NULL`.

### `tournament_entries` — novas colunas

```sql
payment_status     text not null default 'free'
                   check (payment_status in ('free','pending','paid'))
discount_pct       numeric(5,2) not null default 0  -- % de desconto aplicado no momento da inscrição
final_price_cents  integer not null default 0        -- entry_price_cents * (100 - discount_pct) / 100
receipt_url        text      -- nullable; path no bucket payment-receipts (não a URL pública)
```

### `organizations` — novas colunas

```sql
tournament_discount_2_pct  integer not null default 30  -- desconto no 2º torneio pago da semana
tournament_discount_3_pct  integer not null default 50  -- desconto no 3º+ torneio pago da semana
```

---

## Lógica de desconto (função pura)

**Arquivo:** `lib/torneios/entryDiscount.ts`

```ts
export function computeEntryDiscount(
  weeklyPaidCount: number,   // entradas pagas ou pendentes do jogador na semana, ANTES desta
  discount2Pct: number,      // org.tournament_discount_2_pct
  discount3Pct: number,      // org.tournament_discount_3_pct
): number {
  if (weeklyPaidCount === 0) return 0
  if (weeklyPaidCount === 1) return discount2Pct
  return discount3Pct
}

export function applyDiscount(priceCents: number, discountPct: number): number {
  return Math.round(priceCents * (100 - discountPct) / 100)
}
```

**"Semana":** segunda a domingo do calendário ISO (America/Sao_Paulo). Helper `getWeekBounds(date: Date): { start: Date; end: Date }` em `lib/utils/weekHelpers.ts`.

**Quais entradas contam para o threshold:**
- Mesmo jogador (`player_id`)
- Mesma semana calendário
- `entry_price_cents > 0` (torneios gratuitos não contam)
- `payment_status IN ('pending', 'paid')` (canceladas não contam)

---

## Fluxo do jogador (página pública `/t/[id]`)

### Torneio gratuito
Comportamento atual — botão "Inscrever-se", inscrição imediata, `payment_status = 'free'`.

### Torneio pago
1. Página exibe: valor original, desconto se aplicável ("R$ 70,00 — 30% de desconto"), valor final, chave PIX.
2. Botão **"Confirmar inscrição"** — cria a entrada com `payment_status = 'pending'`, `discount_pct` e `final_price_cents` gravados.
3. Após inscrição, seção de **comprovante** aparece: campo de upload de imagem (opcional). Upload vai para `payment-receipts/{tournamentId}/{userId}/receipt.{ext}`. Salva URL em `receipt_url`.
4. Badge "Aguardando confirmação" enquanto `pending`.
5. Após admin confirmar: badge "Inscrição confirmada ✓".

**Entradas `pending` já aparecem na chave gerada** — a confirmação de pagamento é financeira, não bloqueia participação.

---

## Fluxo do admin

### Página `/admin/torneios/[id]`

Lista de inscrições ganha coluna de status:
- ⚪ **Gratuito** — sem ação necessária
- 🟡 **Aguardando pagamento** — mostra valor (`final_price_cents`), miniatura do comprovante (se houver), botão **"Confirmar pagamento"**
- 🟢 **Pago** — confirmado

Botão "Confirmar pagamento" chama action `confirmEntryPayment(entryId)` → `payment_status = 'paid'`.

### Criação/edição de torneio

`CreateTournamentForm` ganha dois campos opcionais:
- **Valor da inscrição (R$)** — número decimal, convertido para centavos
- **Chave PIX** — texto livre

### `/admin/configuracoes` — seção "Torneios"

Dois campos numéricos:
- Desconto no 2º torneio da semana (%)
- Desconto no 3º+ torneio da semana (%)

Action `updateTournamentDiscountSettings(discount2Pct, discount3Pct)`.

---

## Cancelamento com reversal de desconto

Action `removeEntry(tournamentId, playerId?)`:

1. Se `payment_status = 'free'` → remove e pronto.
2. Se `entry_price_cents > 0`:
   - Remove a entrada.
   - Busca todas as entradas `pending` do mesmo jogador na mesma semana com `entry_price_cents > 0`, ordenadas por `created_at ASC`.
   - Recalcula `discount_pct` e `final_price_cents` para cada uma (índice na lista = posição na semana).
   - Entradas `paid` **não são recalculadas** — pagamento já recebido.

---

## Cadastro de jogador externo

### Problema
`/cadastro` exige código de convite → bloqueia externos que chegam via `/t/[id]`.

### Solução
Nova página **`/t/[id]/cadastrar`** no grupo `(public)`:
- Campos: nome completo, e-mail, senha.
- Sem campo de convite.
- Chama `supabase.auth.signUp({ email, password, options: { data: { full_name } } })` — sem `invite_code` nos metadados.
- O trigger `handle_new_user` só cria membership se `invite_code` estiver presente → cria apenas `profiles` sem membership (conta "avulsa").
- Após signup, redireciona para `/t/[id]` para completar a inscrição.

Na página `/t/[id]`, o link de criação de conta aponta para `/t/[id]/cadastrar` (não para `/cadastro`).

**Conta avulsa:** tem `profiles` mas nenhuma `membership`. Pode se inscrever em torneios via `registerExternal()` (que usa `createAdminClient()`, sem RLS de membership). Não acessa dashboard da academia.

---

## Storage — bucket `payment-receipts`

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-receipts', 'payment-receipts', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Jogador faz upload apenas para o próprio path
DROP POLICY IF EXISTS "receipts_upload" ON storage.objects;
CREATE POLICY "receipts_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Leitura: próprio jogador ou admin via service role
DROP POLICY IF EXISTS "receipts_read_own" ON storage.objects;
CREATE POLICY "receipts_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
```

**Leitura do comprovante pelo admin:** o bucket é privado. A página `/admin/torneios/[id]/page.tsx` é um Server Component — usa `createAdminClient().storage.from('payment-receipts').createSignedUrl(receipt_url, 300)` para gerar uma URL assinada com 5 min de validade e passa para o componente de exibição. Jogador lê o próprio comprovante com `createClient()` (browser) + signed URL gerada client-side.

---

## Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20260630000100_tournament_entry_payment.sql` | Novas colunas em `tournaments`, `tournament_entries`, `organizations` |
| `supabase/migrations/20260630000200_payment_receipts_bucket.sql` | Bucket + policies |
| `lib/torneios/entryDiscount.ts` | Funções puras `computeEntryDiscount` + `applyDiscount` |
| `lib/torneios/entryDiscount.test.ts` | Testes TDD |
| `lib/utils/weekHelpers.ts` | `getWeekBounds(date)` → `{ start, end }` (seg–dom, America/Sao_Paulo) |
| `lib/utils/weekHelpers.test.ts` | Testes TDD |
| `types/index.ts` | `Tournament` + `TournamentEntry` + `Organization` com novas colunas |
| `features/torneios/actions.ts` | `registerExternal` com desconto + `confirmEntryPayment` + `removeEntry` com reversal + `updateTournamentDiscountSettings` |
| `app/(public)/t/[id]/page.tsx` | Seção de preço + PIX + comprovante |
| `app/(public)/t/[id]/ReceiptUploadButton.tsx` | Client Component upload de comprovante |
| `app/(public)/t/[id]/cadastrar/page.tsx` | Cadastro avulso sem invite |
| `app/(admin)/admin/torneios/[id]/page.tsx` | Badges de status + botão confirmar pagamento |
| `app/(admin)/admin/torneios/[id]/ConfirmPaymentButton.tsx` | Client Component botão confirmar |
| `app/(admin)/admin/torneios/CreateTournamentForm.tsx` | Campos entry_price + pix_key |
| `app/(admin)/admin/configuracoes/page.tsx` | Seção desconto torneios |

---

## Fora de escopo

- Integração automática com PIX (webhook de pagamento) — o fluxo é 100% manual.
- Reembolso automático ao cancelar entrada já paga.
- Notificações por e-mail/push ao confirmar pagamento.
- Histórico de pagamentos de torneios no painel financeiro.
